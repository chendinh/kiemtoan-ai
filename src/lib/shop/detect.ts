// Nhận diện loại bảng của một tab bằng các nhãn tiêu đề. Kết quả là Layout (loại, hàng tiêu đề, cột của từng trường).
// Layout cũng là dạng mà lớp AI đề xuất cho tab lạ; mọi Layout đều phải qua validateLayout trước khi dùng.

import type { Grid, Label } from "./grid";
import type { Layout, ShopTableKind } from "./types";

type Test = (n: string) => boolean;
interface FieldSpec {
  field: string;
  test: Test;
  required?: boolean;
}

const eq =
  (s: string): Test =>
  (n) =>
    n === s;
const has =
  (s: string): Test =>
  (n) =>
    n.includes(s);
const starts =
  (s: string): Test =>
  (n) =>
    n.startsWith(s);
const re =
  (r: RegExp): Test =>
  (n) =>
    r.test(n);

/** Thứ tự kiểm tra: loại có nhãn đặc thù nhất đứng trước. */
const SPECS: { kind: ShopTableKind; fields: FieldSpec[] }[] = [
  {
    kind: "gaProducts",
    fields: [
      { field: "code", test: eq("ma kg"), required: true },
      { field: "sku", test: eq("ma sp"), required: true },
      { field: "paidForItem", test: has("tien tra kh"), required: true },
    ],
  },
  {
    kind: "gaOrders",
    fields: [
      { field: "code", test: eq("ma kg"), required: true },
      { field: "owed", test: eq("tien phai tra kh"), required: true },
      { field: "status", test: eq("trang thai thanh toan"), required: true },
      { field: "created", test: eq("ngay tao") },
      { field: "batch", test: eq("dot ky gui") },
      { field: "qty", test: eq("sl san pham") },
      { field: "sold", test: eq("da ban") },
      { field: "method", test: eq("hinh thuc nhan tien") },
      { field: "paidAt", test: eq("thoi gian tra tien") },
      { field: "due", test: eq("hen tra tien") },
    ],
  },
  {
    kind: "lots",
    fields: [
      { field: "qtyIn", test: eq("sl sp ky gui"), required: true },
      { field: "owed", test: eq("tong tra khach"), required: true },
      { field: "qtySold", test: eq("sl sp da ban") },
      { field: "left", test: starts("sl ton") },
      { field: "ckDate", test: eq("ngay ck") },
      { field: "note", test: eq("ghi chu note") },
      { field: "noteAlt", test: eq("ghi chu") },
    ],
  },
  {
    kind: "payouts",
    fields: [
      { field: "code", test: starts("ma kg"), required: true },
      { field: "batch", test: starts("thang kg"), required: true },
      { field: "amount", test: starts("tong tien"), required: true },
      { field: "date", test: starts("ngay") },
      { field: "note", test: starts("note") },
    ],
  },
  {
    kind: "ledger",
    fields: [
      { field: "received", test: has("da nhan"), required: true },
      { field: "balance", test: has("con lai"), required: true },
      { field: "paid", test: re(/tong tra/), required: true },
      { field: "salary", test: has("luong") },
      { field: "utilities", test: has("dien") },
      { field: "purchases", test: has("thu mua") },
      { field: "otherExpense", test: re(/chi phi khac|chi tieu/) },
      { field: "refund", test: re(/hoan tra|rui ro/) },
      { field: "date", test: starts("ngay") },
      { field: "note", test: starts("note") },
    ],
  },
  {
    kind: "daySummary",
    fields: [
      { field: "date", test: eq("ngay"), required: true },
      { field: "current", test: re(/^thang \d{3,4}$/), required: true },
      { field: "previous", test: eq("thang cu"), required: true },
      { field: "note", test: eq("note") },
    ],
  },
  {
    kind: "revenue",
    fields: [
      { field: "revenue", test: eq("doanh thu"), required: true },
      { field: "offline", test: eq("offline"), required: true },
      { field: "online", test: eq("online"), required: true },
      { field: "expense", test: eq("chi phi") },
      { field: "transfer", test: eq("chuyen khoan") },
      { field: "discount", test: eq("chiet khau") },
      { field: "cash", test: eq("tien mat") },
      { field: "day", test: starts("ngay") },
    ],
  },
  {
    kind: "monthly",
    fields: [
      { field: "month", test: eq("thang"), required: true },
      { field: "revenue", test: eq("doanh thu"), required: true },
      { field: "owed", test: has("tong tra khach"), required: true },
      { field: "received", test: has("tong tien nhan"), required: true },
      { field: "paid", test: has("tong tien da tra") },
      { field: "expense", test: eq("chi phi") },
      { field: "refund", test: re(/hoan tra|rui ro/) },
      { field: "left", test: has("con lai") },
    ],
  },
];

/** Số hàng đầu sheet được quét tìm tiêu đề. */
const SCAN_ROWS = 100;

function matchRow(labels: Label[], fields: FieldSpec[]): Record<string, number> | null {
  const cols: Record<string, number> = {};
  for (const f of fields) {
    // Với trường có nhiều ứng viên, lấy cột đầu tiên khớp (trái nhất).
    const hit = labels.find((l) => f.test(l.n) && !Object.values(cols).includes(l.c));
    if (hit) cols[f.field] = hit.c;
    else if (f.required) return null;
  }
  return cols;
}

/** Tab "Tổng quan" của file xuất từ hệ thống: cột A có nhãn "Tổng số đơn ký gửi". */
function looksLikeGaOverview(g: Grid): boolean {
  let hits = 0;
  for (let r = 0; r <= Math.min(g.r1, 40); r++) {
    const n = g.labels(r, 3)[0]?.n ?? "";
    if (n === "tong so don ky gui" || n.startsWith("tong tien phai tra kh") || n === "tong so san pham") hits++;
  }
  return hits >= 2;
}

/**
 * Hàng tiêu đề của bảng ký gửi chỉ có tên cột số liệu; cột mã KG và đợt luôn đứng ngay trước "SL sp ký gửi".
 * Nhãn "MÃ KG" (nếu có) xác nhận lại vị trí cột mã.
 */
export function resolveLots(g: Grid, headerRow: number, cols: Record<string, number>): Record<string, number> {
  const out = { ...cols };
  let code = out.qtyIn - 2;
  for (let r = headerRow; r <= Math.min(headerRow + 3, g.r1); r++) {
    const hit = g.labels(r).find((l) => l.n === "ma kg" && l.c >= out.qtyIn - 4 && l.c < out.qtyIn);
    if (hit) {
      code = hit.c;
      break;
    }
  }
  out.code = code;
  out.batch = code + 1;
  if (out.note === undefined && out.noteAlt !== undefined) out.note = out.noteAlt;
  delete out.noteAlt;
  return out;
}

export function detectLayout(g: Grid): Layout | null {
  if (g.r1 < 0) return null;
  if (looksLikeGaOverview(g)) return { kind: "gaOverview", headerRow: 0, cols: {}, via: "rules" };

  const last = Math.min(g.r1, SCAN_ROWS);
  for (let r = 0; r <= last; r++) {
    const labels = g.labels(r);
    if (labels.length < 3) continue;
    for (const spec of SPECS) {
      const cols = matchRow(labels, spec.fields);
      if (!cols) continue;
      if (spec.kind === "lots") return { kind: "lots", headerRow: r, cols: resolveLots(g, r, cols), via: "rules" };
      if (spec.kind === "revenue" && cols.day === undefined) cols.day = Math.max(0, cols.revenue - 1);
      if (spec.kind === "payouts" && cols.date === undefined) cols.date = 0;
      if (spec.kind === "ledger" && cols.date === undefined) cols.date = 0;
      return { kind: spec.kind, headerRow: r, cols, via: "rules" };
    }
  }
  return null;
}

/** Các loại bảng mà bộ trích xuất đọc được (gaOverview và gaProducts chỉ ghi nhận, không có cột để ánh xạ). */
export const EXTRACTABLE_KINDS: ShopTableKind[] = ["lots", "payouts", "ledger", "daySummary", "revenue", "monthly", "gaOrders"];

/** Mọi trường mà bộ trích xuất của từng loại bảng biết đọc. Layout có trường ngoài danh sách này bị từ chối. */
export const ALLOWED_FIELDS: Record<ShopTableKind, string[]> = {
  lots: ["code", "batch", "owed", "qtyIn", "qtySold", "left", "ckDate", "note"],
  payouts: ["date", "code", "batch", "amount", "note"],
  ledger: ["date", "received", "paid", "salary", "utilities", "purchases", "otherExpense", "refund", "balance", "note"],
  daySummary: ["date", "current", "previous", "note"],
  revenue: ["day", "revenue", "offline", "online", "expense", "transfer", "discount", "cash"],
  monthly: ["month", "revenue", "owed", "received", "paid", "expense", "refund", "left"],
  gaOrders: ["code", "owed", "status", "created", "batch", "qty", "sold", "method", "paidAt", "due"],
  gaOverview: [],
  gaProducts: [],
};

/** Trường bắt buộc của từng loại bảng; dùng để kiểm Layout do AI đề xuất. */
export const REQUIRED_FIELDS: Record<ShopTableKind, string[]> = {
  lots: ["code", "batch", "owed"],
  payouts: ["date", "code", "batch", "amount"],
  ledger: ["received", "paid", "balance"],
  daySummary: ["date", "current", "previous"],
  revenue: ["day", "revenue"],
  monthly: ["month", "revenue"],
  gaOrders: ["code", "owed", "status"],
  gaOverview: [],
  gaProducts: [],
};
