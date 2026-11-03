// Đọc Word: .docx (mammoth -> HTML -> bảng + đoạn văn) và .doc (word-extractor -> văn bản có tab).

import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import type { AuditRecord, DeclaredTotal } from "@/lib/types";
import type { Cell } from "@/lib/util/values";
import type { Field } from "./columns";
import { type MergeRange, type TableContext, processTable } from "./table";
import { parseTextLines } from "./textfile";

export interface WordResult {
  records: AuditRecord[];
  totals: DeclaredTotal[];
  warnings: string[];
  scanned: number;
  skipped: number;
  text: string;
  tables: number;
  cols?: Partial<Record<Field, number>>;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function cellTextFromHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/p>\s*<p[^>]*>/gi, " ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function attrNumber(attrs: string, name: string): number {
  const m = new RegExp(`${name}="(\\d+)"`, "i").exec(attrs);
  return m ? Math.max(1, Number(m[1])) : 1;
}

interface HtmlTable {
  grid: Cell[][];
  merges: MergeRange[];
}

function parseHtmlTable(tableHtml: string): HtmlTable {
  const grid: Cell[][] = [];
  const merges: MergeRange[] = [];
  const occupied = new Set<string>();
  const rowMatches = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  rowMatches.forEach((rowHtml, r) => {
    if (!grid[r]) grid[r] = [];
    let c = 0;
    const cellRe = /<t([dh])([^>]*)>([\s\S]*?)<\/t\1>/gi;
    let m: RegExpExecArray | null;
    while ((m = cellRe.exec(rowHtml)) !== null) {
      while (occupied.has(`${r}:${c}`)) c++;
      const colspan = attrNumber(m[2], "colspan");
      const rowspan = attrNumber(m[2], "rowspan");
      const text = cellTextFromHtml(m[3]);
      while (grid[r].length <= c) grid[r].push(null);
      grid[r][c] = text === "" ? null : text;
      if (colspan > 1 || rowspan > 1) {
        merges.push({ r, c, rows: rowspan, cols: colspan });
        for (let rr = r; rr < r + rowspan; rr++) {
          for (let cc = c; cc < c + colspan; cc++) {
            if (rr === r && cc === c) continue;
            occupied.add(`${rr}:${cc}`);
          }
        }
      }
      c += colspan;
    }
  });
  const width = Math.max(0, ...grid.map((row) => row.length));
  for (const row of grid) while (row.length < width) row.push(null);
  return { grid, merges };
}

export async function parseDocx(buf: Buffer, ctx: TableContext): Promise<WordResult> {
  const { value: html } = await mammoth.convertToHtml({ buffer: buf });
  const result: WordResult = { records: [], totals: [], warnings: [], scanned: 0, skipped: 0, text: "", tables: 0 };

  const tableHtmls = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  result.tables = tableHtmls.length;

  const tableTexts: string[] = [];
  tableHtmls.forEach((th, idx) => {
    const { grid, merges } = parseHtmlTable(th);
    tableTexts.push(grid.map((row) => row.map((c) => (typeof c === "string" ? c : "")).join(" | ")).join("\n"));
    const r = processTable(grid, ctx, {
      locate: (i) => ({ sheet: `Bảng ${idx + 1}`, row: i + 1 }),
      merges,
      allowInfer: false,
    });
    if (!r) return;
    result.records.push(...r.records);
    result.totals.push(...r.totals);
    result.scanned += r.scanned;
    result.skipped += r.skipped;
    result.warnings.push(...r.warnings.map((w) => `Bảng ${idx + 1}: ${w}`));
    if (!result.cols && r.map) result.cols = r.map.cols;
  });

  const paragraphsHtml = html
    .replace(/<table[\s\S]*?<\/table>/gi, "\n")
    .replace(/<\/(p|h\d|li)>|<br\s*\/?>/gi, "\n");
  const paragraphs = decodeEntities(paragraphsHtml.replace(/<[^>]+>/g, ""))
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  result.text = [paragraphs.join("\n"), ...tableTexts].filter(Boolean).join("\n\n");

  if (result.records.length === 0) {
    const r = parseTextLines(
      paragraphs.map((t, i) => ({ text: t, loc: { row: i + 1 } })),
      ctx,
    );
    if (r.records.length > 0) {
      result.records = r.records;
      result.totals = r.totals;
      result.scanned = r.scanned;
      result.skipped = r.skipped;
      result.warnings.push(...r.warnings);
    } else if (tableHtmls.length === 0) {
      result.warnings.push("Tài liệu Word không có bảng giao dịch; nội dung được giữ lại làm văn bản tham khảo cho AI.");
    } else {
      result.warnings.push("Không nhận diện được bảng giao dịch trong tài liệu Word; nội dung được giữ lại làm văn bản tham khảo cho AI.");
    }
  }
  return result;
}

export async function parseDoc(buf: Buffer, ctx: TableContext): Promise<WordResult> {
  const extractor = new WordExtractor();
  const doc = await extractor.extract(buf);
  const body = doc.getBody();
  const lines = body
    .split(/\r\n|\n|\r/)
    .map((t, i) => ({ text: t.replace(/\u0007/g, "").replace(/[ \u00a0]+$/g, ""), loc: { row: i + 1 } }));
  const r = parseTextLines(lines, ctx);
  const result: WordResult = {
    records: r.records,
    totals: r.totals,
    warnings: [...r.warnings],
    scanned: r.scanned,
    skipped: r.skipped,
    text: lines.map((l) => l.text).join("\n"),
    tables: 0,
  };
  if (r.records.length === 0) {
    result.warnings.push("Không nhận diện được bảng giao dịch trong tài liệu .doc; nội dung được giữ lại làm văn bản tham khảo cho AI.");
  }
  return result;
}
