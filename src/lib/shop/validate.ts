// Kiểm chứng một Layout (do luật, AI hay bộ nhớ đệm đề xuất) trên dữ liệu thật của tab trước khi dùng.
// Đây là chốt chặn cuối: dù Layout từ đâu đến, chỉ khi cột được ánh xạ thật sự chứa đúng kiểu dữ liệu và trích xuất ra đủ dòng thì mới được dùng.

import { normText } from "@/lib/util/text";
import { ALLOWED_FIELDS, EXTRACTABLE_KINDS, REQUIRED_FIELDS } from "./detect";
import { monthYearFromName } from "./extract";
import type { Grid } from "./grid";
import { parseBatch, parseGaKey } from "./keys";
import type { Layout } from "./types";
import { emptyShopData } from "./types";
import { extractWithLayout } from "./workbook";

export interface VerifyResult {
  ok: boolean;
  /** Lý do bị từ chối (rỗng nếu ok). */
  reasons: string[];
  /** Ghi chú khi vẫn dùng được, ví dụ cột phụ đã bị cắt bỏ. */
  notes: string[];
  /** Số dòng dữ liệu trích xuất được trong lần chạy thử. */
  rows: number;
  /** Bố cục sau kiểm chứng (đã cắt cột phụ sai kiểu): đây mới là bố cục được phép dùng. */
  layout?: Layout;
}

const MAX_COL = 59;
const SAMPLE = 400;
/** Tỷ lệ ô đúng kiểu tối thiểu trong các ô không rỗng của một cột bắt buộc hoặc cột tiền. */
const MIN_RATIO = 0.7;
/** Cột phụ không phải tiền dưới mức này thì bị cắt bỏ khỏi bố cục. */
const PRUNE_BELOW = 0.5;
/** Lô có số phải trả vượt mức này (nghìn đồng, tương đương 5 tỷ đồng) gần như chắc chắn đang ghi bằng đồng, sai quy ước đơn vị. */
const MAX_THOUSAND_UNIT = 5_000_000;

const MONEY = new Set(["owed", "amount", "received", "paid", "balance", "salary", "utilities", "purchases", "otherExpense", "refund", "current", "previous", "revenue", "offline", "online", "expense", "transfer", "discount", "cash"]);
const COUNTS = new Set(["qtyIn", "qtySold", "left", "qty", "sold"]);
const DATES = new Set(["date", "ckDate", "created", "paidAt", "due"]);
/** Trường khóa của từng loại bảng: cần nhiều ô có dữ liệu để chắc đó đúng là cột đó. */
const PRIMARY: Record<string, string[]> = {
  lots: ["code", "owed"],
  payouts: ["code", "amount"],
  ledger: ["balance"],
  daySummary: ["date", "current"],
  revenue: ["day", "revenue"],
  monthly: ["month", "revenue"],
  gaOrders: ["code", "owed"],
};
/** Trường số có đơn vị nghìn đồng theo quy ước của shop. */
const THOUSAND_UNIT: Record<string, string[]> = { lots: ["owed"], payouts: ["amount"] };

function isStatus(text: string): boolean {
  const n = normText(text);
  return n === "da tra" || n === "chua tra";
}

export function verifyLayout(g: Grid, input: Layout): VerifyResult {
  const reasons: string[] = [];
  const notes: string[] = [];
  const fail = (rows = 0): VerifyResult => ({ ok: false, reasons, notes, rows });
  const letter = (c: number): string => g.addr(0, c).replace(/\d+/g, "");

  if (!EXTRACTABLE_KINDS.includes(input.kind)) {
    reasons.push(`loại bảng "${input.kind}" không có bộ đọc`);
    return fail();
  }
  if (!Number.isInteger(input.headerRow) || input.headerRow < -1 || input.headerRow > Math.min(g.r1, 100)) {
    reasons.push(`hàng tiêu đề ${input.headerRow} nằm ngoài bảng`);
    return fail();
  }

  const allowed = new Set(ALLOWED_FIELDS[input.kind]);
  const used = new Map<number, string>();
  for (const [field, col] of Object.entries(input.cols)) {
    if (!allowed.has(field)) reasons.push(`trường "${field}" không thuộc loại bảng ${input.kind}`);
    else if (!Number.isInteger(col) || col < 0 || col > Math.min(g.c1, MAX_COL)) reasons.push(`cột của "${field}" (${col}) nằm ngoài bảng`);
    else if (used.has(col)) reasons.push(`hai trường "${used.get(col)}" và "${field}" cùng trỏ vào cột ${letter(col)}`);
    else used.set(col, field);
  }
  for (const f of REQUIRED_FIELDS[input.kind]) if (input.cols[f] === undefined) reasons.push(`thiếu trường bắt buộc "${f}"`);
  if (reasons.length > 0) return fail();

  // ---- lấy mẫu các dòng dữ liệu: dòng có ít nhất một ô khác rỗng ở các cột được ánh xạ
  const cols = { ...input.cols };
  const sample: number[] = [];
  for (let r = input.headerRow + 1; r <= g.r1 && sample.length < SAMPLE; r++) {
    if (Object.values(cols).some((c) => !g.isEmpty(r, c))) sample.push(r);
  }
  const minRows = input.kind === "monthly" ? 1 : 3;
  if (sample.length < minRows) {
    reasons.push(`chỉ có ${sample.length} dòng dữ liệu dưới hàng tiêu đề (cần ít nhất ${minRows})`);
    return fail();
  }

  const required = new Set(REQUIRED_FIELDS[input.kind]);
  const primary = new Set(PRIMARY[input.kind] ?? []);

  /** Tỷ lệ ô đúng kiểu của một trường, hoặc null nếu trường không bị ép kiểu. */
  const ratioOf = (field: string, col: number, cells: number[]): { ratio: number; expected: string } | null => {
    let valid: number;
    let expected: string;
    if (MONEY.has(field) || COUNTS.has(field)) {
      expected = "số";
      valid = cells.filter((r) => g.numInfo(r, col) !== null).length;
    } else if (DATES.has(field)) {
      expected = "ngày";
      valid = cells.filter((r) => g.date(r, col) !== null).length;
    } else if (field === "batch") {
      expected = "mã đợt (ví dụ 926)";
      valid = cells.filter((r) => parseBatch(g.text(r, col)) !== null).length;
    } else if (field === "month") {
      expected = "số tháng 1-12";
      valid = cells.filter((r) => {
        const v = g.num(r, col);
        return v !== null && Number.isInteger(v) && v >= 1 && v <= 12;
      }).length;
    } else if (field === "day") {
      expected = "ngày trong tháng";
      valid = cells.filter((r) => {
        const v = g.num(r, col);
        return (v !== null && Number.isInteger(v) && v >= 1 && v <= 31) || g.date(r, col) !== null;
      }).length;
    } else if (field === "status") {
      expected = "trạng thái Đã trả/Chưa trả";
      valid = cells.filter((r) => isStatus(g.text(r, col))).length;
    } else if (field === "code" && input.kind === "gaOrders") {
      expected = "mã kiểu 278-326";
      valid = cells.filter((r) => parseGaKey(g.text(r, col)) !== null).length;
    } else return null; // mã khách, ghi chú, hình thức nhận tiền...: không ép kiểu
    return { ratio: valid / cells.length, expected };
  };

  for (const [field, col] of Object.entries(input.cols)) {
    const cells = sample.filter((r) => !g.isEmpty(r, col));
    const isRequired = required.has(field);
    if (cells.length === 0) {
      if (isRequired) reasons.push(`cột ${letter(col)} (${field}) rỗng ở mọi dòng dữ liệu`);
      else {
        delete cols[field];
        notes.push(`cột ${letter(col)} (${field}) rỗng nên bị bỏ`);
      }
      continue;
    }
    if (primary.has(field) && cells.length < 3) {
      reasons.push(`cột ${letter(col)} (${field}) chỉ có ${cells.length} ô có dữ liệu`);
      continue;
    }
    const r = ratioOf(field, col, cells);
    if (!r) continue;
    const pct = Math.round(r.ratio * 100);
    if (isRequired || MONEY.has(field)) {
      // Cột bắt buộc hoặc cột tiền sai kiểu: ánh xạ này không đáng tin, từ chối cả bố cục (không âm thầm bỏ một khoản tiền).
      if (r.ratio < MIN_RATIO) reasons.push(`cột ${letter(col)} (${field}) chỉ có ${pct}% ô là ${r.expected}, cần từ ${Math.round(MIN_RATIO * 100)}%`);
    } else if (r.ratio < PRUNE_BELOW) {
      delete cols[field];
      notes.push(`cột ${letter(col)} (${field}) chỉ có ${pct}% ô là ${r.expected} nên bị bỏ khỏi bố cục`);
    }
  }

  // ---- đơn vị tiền theo quy ước của shop
  for (const field of THOUSAND_UNIT[input.kind] ?? []) {
    const col = cols[field];
    if (col === undefined) continue;
    let max = 0;
    for (const r of sample) max = Math.max(max, Math.abs(g.num(r, col) ?? 0));
    if (max > MAX_THOUSAND_UNIT) {
      reasons.push(`cột ${letter(col)} (${field}) có giá trị lớn nhất ${Math.round(max).toLocaleString("vi-VN")}: bảng này ghi bằng đồng chứ không phải nghìn đồng như quy ước của shop`);
    }
  }
  if (reasons.length > 0) return fail();

  const layout: Layout = { kind: input.kind, headerRow: input.headerRow, cols, via: input.via };

  // ---- hàng tiêu đề phải là tiêu đề: không được chứa số/ngày ở các cột kiểu số, và phía trên nó không được có cả khối dữ liệu
  if (input.headerRow >= 0) {
    const numericCols = Object.entries(cols).filter(([f]) => MONEY.has(f) || DATES.has(f));
    const dataLike = numericCols.filter(([f, c]) => (MONEY.has(f) ? g.numInfo(input.headerRow, c) !== null : g.date(input.headerRow, c) !== null)).length;
    if (numericCols.length > 0 && dataLike / numericCols.length > 0.5) {
      reasons.push(`hàng ${input.headerRow + 1} được khai là tiêu đề nhưng chứa số/ngày ở ${dataLike}/${numericCols.length} cột kiểu số, trông như một dòng dữ liệu`);
      return fail();
    }
    const keyCol = cols[[...primary].find((f) => cols[f] !== undefined && (MONEY.has(f) || DATES.has(f))) ?? ""];
    if (keyCol !== undefined) {
      let above = 0;
      for (let r = 0; r < input.headerRow; r++) if (g.numInfo(r, keyCol) !== null || g.date(r, keyCol) !== null) above++;
      if (above >= 5) {
        reasons.push(`phía trên hàng tiêu đề đã có ${above} dòng dữ liệu ở cột ${letter(keyCol)}: hàng tiêu đề đặt quá thấp`);
        return fail();
      }
    }
  }

  // ---- tab doanh thu không có tháng/năm trong tên: bố cục đúng nhưng bộ đọc cố ý không xếp vào kỳ nào, nên không có dòng để đếm
  if (input.kind === "revenue" && monthYearFromName(g.name) === null) {
    notes.push("bố cục hợp lệ nhưng tên tab không có tháng/năm nên chưa xếp được vào kỳ nào");
    return { ok: true, reasons: [], notes, rows: 0, layout };
  }

  // ---- chạy thử bộ trích xuất: phải ra đủ dòng so với số dòng có dữ liệu
  const tmp = emptyShopData();
  let accepted = false;
  try {
    accepted = extractWithLayout(g, { ...layout, via: "ai" }, { fileId: "check", fileName: "check" }, tmp);
  } catch (e) {
    reasons.push(`bộ trích xuất báo lỗi: ${e instanceof Error ? e.message : String(e)}`);
    return fail();
  }
  const rows = tmp.tabs[0]?.rows ?? 0;
  if (!accepted || rows < minRows) {
    reasons.push(`trích xuất thử chỉ ra ${rows} dòng (cần ít nhất ${minRows})`);
    return fail(rows);
  }
  const coverage = rows / sample.length;
  if (coverage < 0.5 && input.kind !== "monthly") {
    reasons.push(`chỉ trích xuất được ${rows}/${sample.length} dòng có dữ liệu (${Math.round(coverage * 100)}%), cần từ 50%`);
    return fail(rows);
  }
  return { ok: true, reasons: [], notes, rows, layout };
}
