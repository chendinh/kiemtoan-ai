// Đọc CSV/TXT/văn bản thuần: giải mã, dò dấu phân cách, bảng căn cột, hoặc từng dòng "ngày + số tiền".

import type { AuditRecord, DeclaredTotal } from "@/lib/types";
import {
  type Cell,
  detectDateOrder,
  parseDate,
  parseNumber,
} from "@/lib/util/values";
import { type ColumnMap, validateColumns } from "./columns";
import { layoutToTable, textLineToCells } from "./layout";
import {
  type Loc,
  type TableContext,
  type TableResult,
  extractFromTable,
  processTable,
  sampleDateStrings,
} from "./table";

export interface TextLine {
  text: string;
  loc: Loc;
}

export interface TextParseResult {
  records: AuditRecord[];
  totals: DeclaredTotal[];
  scanned: number;
  skipped: number;
  warnings: string[];
}

// ---------------------------------------------------------------- giải mã

export function decodeText(buf: Uint8Array): { text: string; encoding: string } {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(buf.subarray(3)), encoding: "utf-8" };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(buf.subarray(2)), encoding: "utf-16le" };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(buf.subarray(2)), encoding: "utf-16be" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buf), encoding: "utf-8" };
  } catch {
    try {
      return { text: new TextDecoder("windows-1258").decode(buf), encoding: "windows-1258" };
    } catch {
      return { text: new TextDecoder("latin1").decode(buf), encoding: "latin1" };
    }
  }
}

// ---------------------------------------------------------------- CSV

/** Tách một dòng theo dấu phân cách, tôn trọng dấu nháy kép. */
export function splitDelimited(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** CSV đầy đủ (hỗ trợ ô có xuống dòng bên trong dấu nháy). */
export function parseCsv(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === delim) {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      rows.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur !== "" || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function countOutsideQuotes(line: string, delim: string): number {
  let n = 0;
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === delim) n++;
  }
  return n;
}

/** Chọn dấu phân cách nhất quán nhất (hoặc null nếu không giống bảng phân cách). */
export function detectDelimiter(lines: string[]): string | null {
  const sample = lines.filter((l) => l.trim()).slice(0, 200);
  if (sample.length < 2) return null;
  let bestDelim: string | null = null;
  let bestScore = 0;
  for (const d of ["\t", ";", "|", ","]) {
    const counts = sample.map((l) => countOutsideQuotes(l, d));
    const hist = new Map<number, number>();
    for (const c of counts) if (c >= 2) hist.set(c, (hist.get(c) ?? 0) + 1);
    let modeFreq = 0;
    for (const f of hist.values()) if (f > modeFreq) modeFreq = f;
    if (modeFreq === 0) continue;
    const score = modeFreq / sample.length;
    if (score < 0.5) continue;
    if (d === ",") {
      // Dấu phẩy trong số "1,500,000" không phải dấu phân cách cột.
      let groups = 0;
      let fields = 0;
      for (const l of sample.slice(0, 60)) {
        for (const f of splitDelimited(l, ",")) {
          fields++;
          if (/^\s*\d{3}\s*$/.test(f)) groups++;
        }
      }
      if (fields > 0 && groups / fields > 0.2) continue;
    }
    if (score > bestScore + 0.02) {
      bestScore = score;
      bestDelim = d;
    }
  }
  return bestDelim;
}

// ---------------------------------------------------------------- dòng văn bản tự do

const DATE_RE = /(?<![\d/.-])(\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2})|\d{4}-\d{2}-\d{2})(?![\d/.-])/g;
const AMOUNT_RE =
  /(?<![\w.,/-])([-−+(]?)(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d{5,}(?=\s*(?:đ|vnd|vnđ|₫)))(\)?)(?![\w/])/giu;

/** Đọc từng dòng có ngày + số tiền: [ngày, diễn giải, số tiền, số dư?]. */
export function freeformToRows(lines: TextLine[]): { rows: Cell[][]; locs: Loc[]; order: ReturnType<typeof detectDateOrder> } {
  const allDates: string[] = [];
  for (const l of lines) for (const m of l.text.matchAll(DATE_RE)) allDates.push(m[1]);
  const order = detectDateOrder(allDates);

  const rows: Cell[][] = [];
  const locs: Loc[] = [];
  for (const l of lines) {
    const dates = [...l.text.matchAll(DATE_RE)];
    if (dates.length === 0) continue;
    const iso = parseDate(dates[0][1], order);
    if (!iso) continue;
    const rest = l.text.replace(DATE_RE, " ");
    const amounts: number[] = [];
    for (const m of rest.matchAll(AMOUNT_RE)) {
      const n = parseNumber(m[2]);
      if (n === null) continue;
      const neg = m[1] === "-" || m[1] === "−" || (m[1] === "(" && m[3] === ")");
      amounts.push(neg ? -n : n);
    }
    if (amounts.length === 0) continue;
    const description = rest
      .replace(AMOUNT_RE, " ")
      .replace(/\s+/g, " ")
      .replace(/^[\s:;|,\-–]+|[\s:;|,\-–]+$/g, "")
      .slice(0, 400);
    rows.push([iso, description || null, amounts[0], amounts.length >= 2 ? amounts[amounts.length - 1] : null]);
    locs.push(l.loc);
  }
  return { rows, locs, order };
}

// ---------------------------------------------------------------- điều phối

function asResult(r: TableResult, extraWarnings: string[] = []): TextParseResult {
  return {
    records: r.records,
    totals: r.totals,
    scanned: r.scanned,
    skipped: r.skipped,
    warnings: [...extraWarnings, ...r.warnings],
  };
}

/**
 * Thử lần lượt: bảng phân cách có tiêu đề -> bảng căn cột có tiêu đề -> từng dòng ngày+số tiền
 * -> bảng phân cách đoán cột.
 */
export function parseTextLines(lines: TextLine[], ctx: TableContext): TextParseResult {
  const nonEmpty = lines.filter((l) => l.text.trim() !== "");
  if (nonEmpty.length === 0) return { records: [], totals: [], scanned: 0, skipped: 0, warnings: [] };

  const delim = detectDelimiter(nonEmpty.map((l) => l.text));
  let delimRows: Cell[][] | null = null;
  if (delim) {
    delimRows = nonEmpty.map((l) => splitDelimited(l.text, delim).map((s) => s.trim() as Cell));
    const r = processTable(delimRows, ctx, { locate: (i) => nonEmpty[i].loc, allowInfer: false });
    if (r) return asResult(r);
  }

  const layoutLines = nonEmpty.map((l) => ({ cells: textLineToCells(l.text), loc: l.loc }));
  const lt = layoutToTable(layoutLines);
  if (lt) {
    const order = detectDateOrder(sampleDateStrings(lt.rows));
    const map: ColumnMap | null = validateColumns(lt.rows, lt.map, order);
    if (map) {
      const r = extractFromTable(lt.rows, map, order, ctx, {
        locate: (i) => lt.locs[i],
        mergeContinuations: true,
      });
      if (r.records.length > 0) return asResult(r);
    }
  }

  const ff = freeformToRows(nonEmpty);
  if (ff.rows.length > 0) {
    const map: ColumnMap = {
      headerRow: -1,
      dataStart: 0,
      cols: { date: 0, description: 1, amount: 2, balance: 3 },
      labels: [],
      inferred: false,
    };
    const r = extractFromTable(ff.rows, map, ff.order, ctx, { locate: (i) => ff.locs[i] });
    if (r.records.length > 0) {
      return asResult(r, [
        "Không thấy bảng có tiêu đề; đã đọc theo từng dòng có ngày và số tiền (số cuối dòng được coi là số dư). Hãy kiểm tra ở tab Dữ liệu.",
      ]);
    }
  }

  if (delimRows) {
    const r = processTable(delimRows, ctx, { locate: (i) => nonEmpty[i].loc, allowInfer: true });
    if (r) return asResult(r);
  }

  return { records: [], totals: [], scanned: nonEmpty.length, skipped: nonEmpty.length, warnings: [] };
}

/** Tệp .csv: dò dấu phân cách rồi xử lý như bảng. */
export function parseCsvText(text: string, ctx: TableContext): TextParseResult {
  const lines = text.split(/\r\n|\n|\r/);
  const delim = detectDelimiter(lines) ?? (lines.slice(0, 5).some((l) => l.includes(";")) ? ";" : ",");
  const rows = parseCsv(text, delim).map((r) => r.map((s) => s.trim() as Cell));
  const r = processTable(rows, ctx, { locate: (i) => ({ row: i + 1 }), allowInfer: true });
  if (r) return asResult(r);
  // CSV lạ: thử như văn bản
  return parseTextLines(
    lines.map((t, i) => ({ text: t, loc: { row: i + 1 } })),
    ctx,
  );
}
