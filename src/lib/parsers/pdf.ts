// Đọc PDF có lớp chữ: dựng lại dòng/ô từ tọa độ, nhận bảng theo tiêu đề cột. Không hỗ trợ PDF scan (cần OCR).

import type { AuditRecord, DeclaredTotal, DocMetadata } from "@/lib/types";
import { detectDateOrder } from "@/lib/util/values";
import { type Field, validateColumns } from "./columns";
import { type LayoutCell, type LayoutLine, layoutToTable } from "./layout";
import { type TableContext, extractFromTable, sampleDateStrings } from "./table";
import { parseTextLines } from "./textfile";

const MAX_PAGES = 300;

export interface PdfResult {
  records: AuditRecord[];
  totals: DeclaredTotal[];
  metadata: DocMetadata;
  warnings: string[];
  scanned: number;
  skipped: number;
  text: string;
  cols?: Partial<Record<Field, number>>;
}

interface RawItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function pdfDateToIso(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(v);
  if (!m) return undefined;
  const [, y, mo = "01", d = "01", h = "00", mi = "00", s = "00"] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Gom các mẩu chữ của một trang thành dòng, mỗi dòng gồm các ô tách bởi khoảng trống lớn. */
function itemsToLines(items: RawItem[], page: number): LayoutLine[] {
  if (items.length === 0) return [];
  const pageH = median(items.map((i) => i.h)) || 10;
  const tol = Math.max(2, pageH * 0.45);
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);

  const groups: RawItem[][] = [];
  let current: RawItem[] = [];
  let lineY = sorted[0].y;
  for (const it of sorted) {
    if (Math.abs(it.y - lineY) <= tol) current.push(it);
    else {
      groups.push(current);
      current = [it];
      lineY = it.y;
    }
  }
  if (current.length) groups.push(current);

  const lines: LayoutLine[] = [];
  groups.forEach((g, idx) => {
    g.sort((a, b) => a.x - b.x);
    const h = median(g.map((i) => i.h)) || pageH;
    const gapBreak = Math.max(4, h * 0.8);
    const cells: LayoutCell[] = [];
    let cur: LayoutCell | null = null;
    let prev: RawItem | null = null;
    for (const it of g) {
      const x1 = it.x + it.w;
      if (cur && prev) {
        const gap = it.x - cur.x1;
        if (gap <= gapBreak) {
          const needSpace = gap > h * 0.12 || /\s$/.test(prev.str) || /^\s/.test(it.str);
          cur.text += (needSpace ? " " : "") + it.str;
          cur.x1 = Math.max(cur.x1, x1);
          prev = it;
          continue;
        }
        cells.push(cur);
      }
      cur = { text: it.str, x0: it.x, x1 };
      prev = it;
    }
    if (cur) cells.push(cur);
    for (const c of cells) c.text = c.text.replace(/\s+/g, " ").trim();
    const filtered = cells.filter((c) => c.text !== "");
    if (filtered.length) lines.push({ cells: filtered, loc: { sheet: `Trang ${page}`, row: idx + 1 } });
  });
  return lines;
}

export async function parsePdf(buf: Buffer, ctx: TableContext): Promise<PdfResult> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });

  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "PasswordException") throw new Error("PDF đặt mật khẩu, không đọc được.");
    throw new Error("Không đọc được file PDF (có thể bị hỏng).");
  }

  const result: PdfResult = {
    records: [],
    totals: [],
    metadata: {},
    warnings: [],
    scanned: 0,
    skipped: 0,
    text: "",
  };

  try {
    try {
      const meta = await doc.getMetadata();
      const info = (meta.info ?? {}) as Record<string, unknown>;
      result.metadata = {
        author: str(info.Author),
        creator: str(info.Creator),
        producer: str(info.Producer),
        created: pdfDateToIso(info.CreationDate),
        modified: pdfDateToIso(info.ModDate),
      };
    } catch {
      // metadata không bắt buộc
    }

    const pages = Math.min(doc.numPages, MAX_PAGES);
    if (doc.numPages > MAX_PAGES) result.warnings.push(`Chỉ đọc ${MAX_PAGES} trang đầu trong ${doc.numPages} trang.`);

    const allLines: LayoutLine[] = [];
    const pageTexts: string[] = [];
    let chars = 0;
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items: RawItem[] = [];
      for (const it of content.items) {
        if (!("str" in it) || !it.str || !it.str.trim()) continue;
        const t = it.transform as number[];
        items.push({ str: it.str, x: t[4], y: t[5], w: it.width, h: it.height || Math.abs(t[3]) || 10 });
      }
      const lines = itemsToLines(items, p);
      allLines.push(...lines);
      const pageText = lines.map((l) => l.cells.map((c) => c.text).join("  ")).join("\n");
      chars += pageText.length;
      pageTexts.push(pageText);
    }
    result.text = pageTexts.join("\n\n");

    if (chars < pages * 20) {
      result.warnings.push("PDF gần như không có lớp chữ (có thể là bản scan/ảnh). Hệ thống chưa hỗ trợ OCR; hãy xuất bản có chữ từ nguồn.");
      return result;
    }

    const lt = layoutToTable(allLines);
    if (lt) {
      const order = detectDateOrder(sampleDateStrings(lt.rows));
      const map = validateColumns(lt.rows, lt.map, order);
      if (map) {
        const r = extractFromTable(lt.rows, map, order, ctx, {
          locate: (i) => lt.locs[i],
          mergeContinuations: true,
        });
        if (r.records.length > 0) {
          result.records = r.records;
          result.totals = r.totals;
          result.scanned = r.scanned;
          result.skipped = r.skipped;
          result.warnings.push(...r.warnings);
          result.cols = map.cols;
          return result;
        }
      }
    }

    const fallback = parseTextLines(
      allLines.map((l) => ({ text: l.cells.map((c) => c.text).join("  "), loc: l.loc })),
      ctx,
    );
    result.records = fallback.records;
    result.totals = fallback.totals;
    result.scanned = fallback.scanned;
    result.skipped = fallback.skipped;
    result.warnings.push(...fallback.warnings);
    if (fallback.records.length === 0) {
      result.warnings.push("Không nhận diện được bảng giao dịch trong PDF. Văn bản vẫn được chuyển cho AI (nếu bật) để tham khảo.");
    }
    return result;
  } finally {
    await doc.destroy();
  }
}
