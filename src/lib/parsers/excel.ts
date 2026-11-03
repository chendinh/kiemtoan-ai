// Đọc Excel (.xlsx/.xls) bằng SheetJS: nhiều sheet, ô gộp, ngày, sheet/hàng/cột ẩn, siêu dữ liệu.
// Tab thuộc nghiệp vụ shop (bảng ký gửi, sổ thu chi...) được nhận diện và trích xuất riêng (lib/shop),
// không đi qua bộ đọc bảng giao dịch chung để tránh sinh bản ghi rác và lộ dữ liệu cá nhân của khách.

import * as XLSX from "xlsx";
import { detectLayout } from "@/lib/shop/detect";
import { Grid } from "@/lib/shop/grid";
import { profileUnknownTab } from "@/lib/shop/profile";
import { type Layout, type ShopFileData, type UnknownTab, emptyShopData, hasShopData } from "@/lib/shop/types";
import { verifyLayout } from "@/lib/shop/validate";
import { extractWithLayout } from "@/lib/shop/workbook";
import type { AuditRecord, DeclaredTotal, DocMetadata, HiddenInfo, StatementMeta } from "@/lib/types";
import {
  type Cell,
  isEmptyCell,
  isPlausibleSerial,
  makeDateCell,
  serialToIso,
} from "@/lib/util/values";
import type { Field } from "./columns";
import { extractStatementMeta } from "./statement";
import { type MergeRange, type TableContext, processTable } from "./table";

const MAX_ROWS = 100_000;
const MAX_COLS = 60;
const UNRECOGNIZED = "không nhận diện được bảng giao dịch (bỏ qua).";

export interface ExcelResult {
  records: AuditRecord[];
  totals: DeclaredTotal[];
  hidden: HiddenInfo;
  metadata: DocMetadata;
  sheets: string[];
  warnings: string[];
  scanned: number;
  skipped: number;
  cols: Partial<Record<Field, number>>;
  /** Các bảng nghiệp vụ shop nhận diện được (chỉ có khi file có ít nhất một tab loại này). */
  shop?: ShopFileData;
  /** Kỳ và số dư đầu/cuối của sao kê ngân hàng trong file. */
  statements: StatementMeta[];
  /**
   * Tab chưa nhận diện kèm lưới ô gốc, để lớp AI có thể đề xuất bố cục rồi áp dụng (xem applyLayouts).
   * Chỉ sống trong một lần phân tích, không được đưa vào kết quả trả về.
   */
  pending: { tab: UnknownTab; grid: Grid }[];
}

/**
 * Áp dụng bố cục đã được kiểm chứng cho các tab chưa nhận diện: trích xuất vào `result.shop` và gỡ tab khỏi danh sách "lạ".
 * Bố cục KHÔNG được tin: được kiểm chứng lại bằng verifyLayout ngay tại đây, bất kể nguồn (AI hay bộ nhớ đệm).
 */
export function applyLayouts(result: ExcelResult, base: { fileId: string; fileName: string }, layouts: Map<string, Layout>): string[] {
  const applied: string[] = [];
  for (const p of result.pending) {
    const proposed = layouts.get(p.tab.sheet);
    if (!proposed) continue;
    const v = verifyLayout(p.grid, proposed);
    if (!v.ok || !v.layout) continue;
    const target = result.shop ?? emptyShopData();
    if (!extractWithLayout(p.grid, { ...v.layout, via: "ai" }, base, target)) continue;
    result.shop = target;
    result.shop.unknown = result.shop.unknown.filter((u) => u.sheet !== p.tab.sheet);
    result.warnings = result.warnings.filter((w) => w !== `Sheet "${p.tab.sheet}": ${UNRECOGNIZED}`);
    result.sheets.push(p.tab.sheet);
    applied.push(p.tab.sheet);
  }
  result.pending = result.pending.filter((p) => !applied.includes(p.tab.sheet));
  return applied;
}

function toIso(v: unknown): string | undefined {
  if (!v) return undefined;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString();
  if (typeof v === "string") return v;
  return undefined;
}

function cellValue(cell: XLSX.CellObject | undefined): Cell {
  if (!cell || cell.v === undefined || cell.v === null) return null;
  switch (cell.t) {
    case "n": {
      const v = cell.v as number;
      if (cell.z && XLSX.SSF.is_date(String(cell.z)) && isPlausibleSerial(v)) {
        const iso = serialToIso(v);
        if (iso) return makeDateCell(iso, v);
      }
      return v;
    }
    case "s":
      return String(cell.v);
    case "b":
      return cell.v ? "TRUE" : "FALSE";
    case "d": {
      const d = cell.v as unknown as Date;
      return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }
    case "e":
      return null;
    default:
      return String(cell.v);
  }
}

export function parseWorkbook(buf: Buffer, ctx: TableContext): ExcelResult {
  const wb = XLSX.read(buf, {
    type: "buffer",
    cellNF: true,
    cellStyles: true,
    cellDates: false,
    // Công thức cần cho kiểm tra tổng/số dư của sổ shop (SUM bỏ sót hàng, số dư gõ tay).
    cellFormula: true,
    sheetRows: MAX_ROWS + 1,
  });

  const out: ExcelResult = {
    records: [],
    totals: [],
    hidden: { sheets: [], rows: [], columns: [] },
    metadata: {},
    sheets: [],
    warnings: [],
    scanned: 0,
    skipped: 0,
    cols: {},
    statements: [],
    pending: [],
  };

  const props = wb.Props;
  if (props) {
    out.metadata = {
      author: props.Author || undefined,
      lastAuthor: props.LastAuthor || undefined,
      application: props.Application || undefined,
      created: toIso(props.CreatedDate),
      modified: toIso(props.ModifiedDate),
    };
  }

  // Lượt 1: dò bố cục từng tab để biết file có phải sổ sách shop không.
  const grids = wb.SheetNames.map((name, idx) => {
    const ws = wb.Sheets[name];
    if (!ws || !ws["!ref"]) return null;
    const state = wb.Workbook?.Sheets?.[idx]?.Hidden ?? 0;
    return new Grid(ws, name, state === 1 || state === 2);
  });
  const layouts = grids.map((g) => (g ? detectLayout(g) : null));
  const isShopBook = layouts.some((l) => l !== null);
  const shop = emptyShopData();
  const base = { fileId: ctx.fileId, fileName: ctx.fileName };

  // Lượt 2: đọc từng tab.
  wb.SheetNames.forEach((name, idx) => {
    const ws = wb.Sheets[name];
    const grid = grids[idx];
    if (!ws || !grid) return;

    const layout = layouts[idx];
    if (layout && extractWithLayout(grid, layout, base, shop)) {
      // Tab shop: không dựng ma trận ô, không đưa vào bộ đọc chung. Trạng thái ẩn (sheet, hàng, cột) được ghi trong ShopTab
      // và do lớp kiểm tiền xét, vì sổ shop cất tab cũ ở chế độ ẩn như một thói quen lưu trữ.
      out.sheets.push(name);
      return;
    }

    const range = XLSX.utils.decode_range(ws["!ref"] as string);
    const maxR = Math.min(range.e.r, MAX_ROWS);
    const maxC = Math.min(range.e.c, MAX_COLS - 1);
    if (range.e.r > MAX_ROWS) out.warnings.push(`Sheet "${name}": chỉ đọc ${MAX_ROWS.toLocaleString("vi-VN")} dòng đầu.`);

    const rows: Cell[][] = [];
    let nonEmptyRows = 0;
    for (let r = 0; r <= maxR; r++) {
      const row: Cell[] = [];
      let any = false;
      for (let c = 0; c <= maxC; c++) {
        const v = cellValue(ws[XLSX.utils.encode_cell({ r, c })]);
        if (v !== null && !isEmptyCell(v)) any = true;
        row.push(v);
      }
      if (any) nonEmptyRows++;
      rows.push(row);
    }

    if (grid.hidden && !isShopBook) {
      out.hidden.sheets.push({
        name,
        state: wb.Workbook?.Sheets?.[idx]?.Hidden === 2 ? "veryHidden" : "hidden",
        hasData: nonEmptyRows >= 1,
      });
    }

    // Hàng/cột ẩn có dữ liệu
    const hiddenRows: number[] = [];
    (ws["!rows"] ?? []).forEach((info, r) => {
      if (info?.hidden && rows[r] && rows[r].some((c) => !isEmptyCell(c))) hiddenRows.push(r + 1);
    });
    if (hiddenRows.length > 0) out.hidden.rows.push({ sheet: name, rows: hiddenRows.slice(0, 200) });
    const hiddenCols: string[] = [];
    (ws["!cols"] ?? []).forEach((info, c) => {
      if (!info?.hidden || c > maxC) return;
      if (rows.some((row) => !isEmptyCell(row[c]))) hiddenCols.push(XLSX.utils.encode_col(c));
    });
    if (hiddenCols.length > 0) out.hidden.columns.push({ sheet: name, columns: hiddenCols });

    const merges: MergeRange[] = (ws["!merges"] ?? []).map((m) => ({
      r: m.s.r,
      c: m.s.c,
      rows: m.e.r - m.s.r + 1,
      cols: m.e.c - m.s.c + 1,
    }));

    // Sao kê ngân hàng: kỳ và số dư đầu/cuối (kể cả khi kỳ đó không có giao dịch nào).
    const stmt = extractStatementMeta(rows, name);
    if (stmt) out.statements.push(stmt);

    // Trong sổ sách shop, tab lạ thường là bảng nháp/phụ: chỉ đọc khi có tiêu đề rõ, không đoán cột theo nội dung.
    // Trong sổ shop, tab đủ lớn mà không khớp bố cục nào thì luôn là "tab lạ" (để AI nếu bật có thể đề xuất bố cục), KHÔNG đọc
    // bằng bộ đọc giao dịch chung: bộ này có thể bắt nhầm một cột (ví dụ tiêu đề có chữ "số tiền") và cho ra các dòng sai mà không cảnh báo.
    const result = isShopBook && nonEmptyRows >= 5
      ? null
      : processTable(rows, ctx, {
          locate: (i) => ({ sheet: name, row: i + 1 }),
          merges,
          allowInfer: !isShopBook,
        });
    if (!result) {
      if (nonEmptyRows >= 5) {
        // Tab không đọc được: lập hồ sơ cột để lớp AI (nếu bật) có thể đề xuất bố cục. Trong sổ shop thì liệt kê là "tab lạ";
        // ở file khác vẫn giữ cảnh báo cũ cho đến khi AI nhận diện được.
        const tab = profileUnknownTab(grid);
        out.pending.push({ tab, grid });
        if (isShopBook) shop.unknown.push(tab);
        else out.warnings.push(`Sheet "${name}": ${UNRECOGNIZED}`);
      }
      return;
    }
    out.records.push(...result.records);
    out.totals.push(...result.totals);
    out.scanned += result.scanned;
    out.skipped += result.skipped;
    out.warnings.push(...result.warnings.map((w) => `Sheet "${name}": ${w}`));
    out.sheets.push(name);
    if (result.map && Object.keys(out.cols).length === 0) out.cols = result.map.cols;
  });

  if (hasShopData(shop)) out.shop = shop;
  return out;
}
