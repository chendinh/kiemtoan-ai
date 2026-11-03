// Dựng bảng từ văn bản có tọa độ (PDF) hoặc văn bản căn cột bằng khoảng trắng (.txt).
// Ô trống (ví dụ cột Nợ để trống) vẫn giữ đúng cột nhờ gán theo vị trí ngang.

import type { Cell } from "@/lib/util/values";
import { parseDate, parseNumber } from "@/lib/util/values";
import { type ColumnMap, evaluateLabels } from "./columns";
import type { Loc } from "./table";

export interface LayoutCell {
  text: string;
  x0: number;
  x1: number;
}

export interface LayoutLine {
  cells: LayoutCell[];
  loc: Loc;
}

export interface LayoutTable {
  rows: Cell[][];
  locs: Loc[];
  map: ColumnMap;
}

const FOOTER_RE = /^(trang|page)\s*\d+(\s*(\/|of|trên)\s*\d+)?$/i;

function looksNumericOrDate(text: string): boolean {
  const t = text.trim();
  return parseNumber(t) !== null || parseDate(t) !== null;
}

/** Tách một dòng văn bản thành các ô theo cụm ≥2 khoảng trắng (tab được quy đổi về khoảng trắng). */
export function textLineToCells(line: string): LayoutCell[] {
  const expanded = line.replace(/\t/g, (_m, offset: number) => " ".repeat(8 - (offset % 8)));
  const cells: LayoutCell[] = [];
  const re = /\S+(?: \S+)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expanded)) !== null) {
    cells.push({ text: m[0], x0: m.index, x1: m.index + m[0].length });
  }
  return cells;
}

export function layoutToTable(lines: LayoutLine[]): LayoutTable | null {
  // 1. Tìm dòng tiêu đề tốt nhất trong ~80 dòng đầu.
  const limit = Math.min(lines.length, 80);
  let headerIdx = -1;
  let best: ReturnType<typeof evaluateLabels> = null;
  for (let i = 0; i < limit; i++) {
    const cells = lines[i].cells;
    if (cells.length < 3) continue;
    const ev = evaluateLabels(cells.map((c) => c.text));
    if (ev && (!best || ev.distinct > best.distinct)) {
      best = ev;
      headerIdx = i;
    }
  }
  if (!best || headerIdx < 0) return null;

  const header = lines[headerIdx].cells;
  const centers = header.map((c) => (c.x0 + c.x1) / 2);
  const bounds: number[] = [];
  for (let k = 0; k < centers.length - 1; k++) bounds.push((centers[k] + centers[k + 1]) / 2);

  const partIndexOf = (x: number): number => {
    let k = 0;
    while (k < bounds.length && x >= bounds[k]) k++;
    return k;
  };

  const assign = (cell: LayoutCell): number => {
    if (looksNumericOrDate(cell.text)) {
      let bestK = 0;
      let bestOv = -Infinity;
      for (let k = 0; k < header.length; k++) {
        const lo = k === 0 ? -Infinity : bounds[k - 1];
        const hi = k === header.length - 1 ? Infinity : bounds[k];
        const ov = Math.min(cell.x1, hi) - Math.max(cell.x0, lo);
        if (ov > bestOv) {
          bestOv = ov;
          bestK = k;
        }
      }
      return bestK;
    }
    return partIndexOf(cell.x0);
  };

  // 2. Gán các dòng sau tiêu đề vào cột.
  const rows: Cell[][] = [];
  const locs: Loc[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = lines[i].cells;
    if (cells.length === 0) continue;
    if (cells.length === 1 && FOOTER_RE.test(cells[0].text.trim())) continue;
    // Dòng tiêu đề lặp lại ở đầu mỗi trang, hoặc dòng tiêu đề song ngữ.
    const ev = cells.length >= 3 ? evaluateLabels(cells.map((c) => c.text)) : null;
    if (ev && ev.distinct >= Math.max(2, best.distinct - 1)) continue;

    const row: Cell[] = new Array<Cell>(header.length).fill(null);
    for (const cell of cells) {
      const k = assign(cell);
      const prev = row[k];
      row[k] = typeof prev === "string" && prev ? `${prev} ${cell.text}` : cell.text;
    }
    rows.push(row);
    locs.push(lines[i].loc);
  }
  if (rows.length === 0) return null;

  const map: ColumnMap = {
    headerRow: -1,
    dataStart: 0,
    cols: best.cols,
    labels: header.map((c) => c.text),
    inferred: false,
  };
  return { rows, locs, map };
}
