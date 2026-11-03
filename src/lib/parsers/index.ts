// Điểm vào của lớp đọc file: nhận buffer + tên file, trả về ParsedFile đã chuẩn hóa.

import type { Layout } from "@/lib/shop/types";
import type { AiStructureNote, FileKind, HiddenInfo, ParsedFile, SourceRole } from "@/lib/types";
import type { Field } from "./columns";
import { type ExcelResult, applyLayouts, parseWorkbook } from "./excel";
import { parsePdf } from "./pdf";
import { guessRole } from "./role";
import type { TableContext } from "./table";
import { decodeText, parseCsvText, parseTextLines } from "./textfile";
import { parseDoc, parseDocx } from "./word";

export interface UploadedFile {
  name: string;
  size: number;
  buffer: Buffer;
}

const EXCEL_EXT = new Set(["xlsx", "xlsm", "xlsb", "xls", "ods"]);
const TEXT_EXT = new Set(["txt", "tsv", "prn", "dat", "log"]);
export const SUPPORTED_EXTENSIONS = ["xlsx", "xlsm", "xlsb", "xls", "ods", "csv", "txt", "tsv", "pdf", "docx", "doc"];

const EXCERPT_CHARS = 4000;

export function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}

function excerpt(text: string): string | undefined {
  const t = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return t ? t.slice(0, EXCERPT_CHARS) : undefined;
}

const emptyHidden = (): HiddenInfo => ({ sheets: [], rows: [], columns: [] });

/** Hàm do lớp AI cung cấp: nhận các tab chưa nhận diện (kèm lưới ô) và trả bố cục + ghi chú cho từng tab. */
export type StructureResolver = (tabs: PendingTab[]) => Promise<{ layouts: Map<string, Layout>; notes: AiStructureNote[] }>;
export type PendingTab = ExcelResult["pending"][number];

export interface ParseOptions {
  /** Có thì các tab Excel chưa nhận diện được sẽ được đưa cho hàm này để đề xuất bố cục (đã kiểm chứng ở applyLayouts). */
  structure?: StructureResolver;
}

export async function parseFile(file: UploadedFile, index: number, options: ParseOptions = {}): Promise<ParsedFile> {
  const fileId = `F${index + 1}`;
  const ext = extensionOf(file.name);
  let counter = 0;
  let role: SourceRole = guessRole(file.name);
  const ctx: TableContext = {
    fileId,
    fileName: file.name,
    role,
    nextId: () => `${fileId}-${String(++counter).padStart(4, "0")}`,
  };

  const base: ParsedFile = {
    fileId,
    fileName: file.name,
    kind: "text",
    sizeBytes: file.size,
    guessedRole: role,
    records: [],
    declaredTotals: [],
    warnings: [],
    hidden: emptyHidden(),
    metadata: {},
    sheets: [],
    rowsScanned: 0,
    rowsSkipped: 0,
  };

  const finish = (p: ParsedFile, cols?: Partial<Record<Field, number>>): ParsedFile => {
    role = guessRole(file.name, cols);
    p.guessedRole = role;
    for (const r of p.records) r.role = role;
    return p;
  };

  try {
    if (EXCEL_EXT.has(ext)) {
      const r = parseWorkbook(file.buffer, ctx);
      let aiStructure: AiStructureNote[] | undefined;
      if (options.structure && r.pending.length > 0) {
        try {
          const resolved = await options.structure(r.pending);
          applyLayouts(r, { fileId, fileName: file.name }, resolved.layouts);
          aiStructure = resolved.notes;
        } catch (e) {
          // Lớp AI chỉ là phần hỗ trợ: lỗi ở đây không được làm hỏng việc đọc file.
          aiStructure = r.pending.map((p) => ({ sheet: p.tab.sheet, status: "no_answer", message: `Không hỏi được AI: ${e instanceof Error ? e.message : "lỗi không rõ"}` }));
        }
      }
      return finish(
        {
          ...base,
          kind: "spreadsheet" as FileKind,
          records: r.records,
          declaredTotals: r.totals,
          shop: r.shop,
          statements: r.statements,
          aiStructure,
          hidden: r.hidden,
          metadata: r.metadata,
          sheets: r.sheets,
          warnings: r.warnings,
          rowsScanned: r.scanned,
          rowsSkipped: r.skipped,
        },
        r.cols,
      );
    }

    if (ext === "csv") {
      const { text } = decodeText(file.buffer);
      const r = parseCsvText(text, ctx);
      return finish({
        ...base,
        kind: "csv",
        records: r.records,
        declaredTotals: r.totals,
        warnings: r.warnings,
        rowsScanned: r.scanned,
        rowsSkipped: r.skipped,
      });
    }

    if (TEXT_EXT.has(ext)) {
      const { text } = decodeText(file.buffer);
      const lines = text.split(/\r\n|\n|\r/).map((t, i) => ({ text: t, loc: { row: i + 1 } }));
      const r = parseTextLines(lines, ctx);
      const warnings = [...r.warnings];
      if (r.records.length === 0) warnings.push("Không tìm thấy dòng giao dịch (ngày + số tiền) trong file văn bản.");
      return finish({
        ...base,
        kind: "text",
        records: r.records,
        declaredTotals: r.totals,
        warnings,
        textExcerpt: excerpt(text),
        rowsScanned: r.scanned,
        rowsSkipped: r.skipped,
      });
    }

    if (ext === "pdf") {
      const r = await parsePdf(file.buffer, ctx);
      return finish(
        {
          ...base,
          kind: "pdf",
          records: r.records,
          declaredTotals: r.totals,
          metadata: r.metadata,
          warnings: r.warnings,
          textExcerpt: excerpt(r.text),
          rowsScanned: r.scanned,
          rowsSkipped: r.skipped,
        },
        r.cols,
      );
    }

    if (ext === "docx" || ext === "doc") {
      const r = ext === "docx" ? await parseDocx(file.buffer, ctx) : await parseDoc(file.buffer, ctx);
      return finish(
        {
          ...base,
          kind: "word",
          records: r.records,
          declaredTotals: r.totals,
          warnings: r.warnings,
          textExcerpt: excerpt(r.text),
          rowsScanned: r.scanned,
          rowsSkipped: r.skipped,
        },
        r.cols,
      );
    }

    return { ...base, error: `Định dạng .${ext || "?"} chưa được hỗ trợ. Hỗ trợ: ${SUPPORTED_EXTENSIONS.join(", ")}.` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...base, error: `Không đọc được file: ${msg}` };
  }
}
