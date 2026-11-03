// Đọc giá trị ô: số (định dạng Việt Nam/Anh), ngày (dd/mm/yyyy ưu tiên), văn bản.

export interface DateCell {
  __date: true;
  iso: string;
  serial: number;
}

export type Cell = string | number | DateCell | null;

export function isDateCell(c: unknown): c is DateCell {
  return typeof c === "object" && c !== null && (c as DateCell).__date === true;
}

export function makeDateCell(iso: string, serial: number): DateCell {
  return { __date: true, iso, serial };
}

/** Văn bản hiển thị của ô, đã gọn khoảng trắng. */
export function cellText(c: Cell | undefined): string {
  if (c === null || c === undefined) return "";
  if (isDateCell(c)) return c.iso;
  if (typeof c === "number") return Number.isFinite(c) ? String(c) : "";
  return c.replace(/[\s\u00a0\u202f]+/g, " ").trim();
}

export function isEmptyCell(c: Cell | undefined): boolean {
  return cellText(c) === "";
}

/**
 * Ô chữ dài kiểu câu (lời cảm ơn, ghi chú pháp lý, nhãn "Số dư cuối kỳ..." ở chân trang sao kê).
 * Không phải giá trị dữ liệu nên bỏ qua khi đánh giá kiểu của cả cột: với sao kê chỉ vài giao dịch,
 * khối chân trang này nếu tính vào sẽ áp đảo và làm cột tiền bị coi là cột chữ.
 */
export function isProseCell(c: Cell | undefined): boolean {
  if (typeof c !== "string") return false;
  const t = c.replace(/[\s\u00a0\u202f]+/g, " ").trim();
  return t.length >= 24 && t.split(" ").length >= 4;
}

/** Ô bắt đầu bằng một ngày dd/mm/yyyy (có thể kèm chữ phía sau, ví dụ "25/02/2026 9701 - 1353575663"). */
export const DATE_PREFIX_RE = /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}(?!\d)/;

export function startsWithDate(c: Cell | undefined): boolean {
  return typeof c === "string" && DATE_PREFIX_RE.test(c.trim());
}

// ---------------------------------------------------------------- số

const CURRENCY_RE = /(vnđ|vnd|usd|eur|đồng|₫|đ|\$|€)/gi;

/**
 * Đọc số từ ô. Hỗ trợ "1.234.567,89", "1,234,567.89", "(1.500)", "-2,000", "1.500-".
 * Trường hợp mơ hồ "1.234" / "1,234" (đúng 3 chữ số sau dấu) được coi là phân cách nghìn.
 */
export function parseNumber(v: Cell | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (isDateCell(v)) return v.serial;

  let s = v.replace(/[\s\u00a0\u202f]/g, "").replace(CURRENCY_RE, "");
  if (!s || s.includes("%")) return null;

  let neg = false;
  if (/^\(.+\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (/^[-−–]/.test(s)) {
    neg = true;
    s = s.slice(1);
  } else if (/[-−–]$/.test(s)) {
    neg = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d([\d.,]*\d)?$/.test(s)) return null;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let decimalSep: "." | "," | null = null;
  if (lastDot >= 0 && lastComma >= 0) {
    decimalSep = lastDot > lastComma ? "." : ",";
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const count = s.split(sep).length - 1;
    const after = s.length - s.lastIndexOf(sep) - 1;
    const intPart = s.slice(0, s.lastIndexOf(sep));
    if (count > 1) decimalSep = null;
    else if (after === 3 && intPart !== "0") decimalSep = null;
    else decimalSep = sep;
  }

  let intStr = s;
  let fracStr = "";
  if (decimalSep) {
    const idx = s.lastIndexOf(decimalSep);
    intStr = s.slice(0, idx);
    fracStr = s.slice(idx + 1);
  }
  intStr = intStr.replace(/[.,]/g, "");
  const n = Number(`${intStr || "0"}${fracStr ? `.${fracStr}` : ""}`);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

// ---------------------------------------------------------------- ngày

export type DateOrder = "dmy" | "mdy";

const MONTHS_EN: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const MIN_YEAR = 1980;
const MAX_YEAR = 2100;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function makeIso(y: number, m: number, d: number): string | null {
  if (y < MIN_YEAR || y > MAX_YEAR || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function fullYear(y: number): number {
  if (y >= 100) return y;
  return y < 70 ? 2000 + y : 1900 + y;
}

/** Serial Excel hợp lý cho ngày giao dịch (1990..2100). */
export function isPlausibleSerial(n: number): boolean {
  return Number.isFinite(n) && n >= 32874 && n <= 73415;
}

export function serialToIso(serial: number): string | null {
  if (!isPlausibleSerial(serial)) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000;
  const dt = new Date(ms);
  return makeIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function parseDate(v: Cell | undefined, order: DateOrder = "dmy"): string | null {
  if (v === null || v === undefined) return null;
  if (isDateCell(v)) return v.iso;
  if (typeof v === "number") return serialToIso(v);

  const s = v.trim();
  if (!s) return null;

  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s,].*)?$/.exec(s);
  if (m) return makeIso(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:[^\d].*)?$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = fullYear(Number(m[3]));
    if (order === "dmy") return makeIso(y, b, a) ?? (a <= 12 && b > 12 ? makeIso(y, a, b) : null);
    return makeIso(y, a, b) ?? (b <= 12 && a > 12 ? makeIso(y, b, a) : null);
  }

  m = /^(\d{1,2})[\s\-/]+([A-Za-z]{3,9})\.?[\s\-/,]+(\d{2,4})/.exec(s);
  if (m) {
    const mon = MONTHS_EN[m[2].slice(0, 3).toLowerCase()];
    if (mon) return makeIso(fullYear(Number(m[3])), mon, Number(m[1]));
  }

  m = /^(?:ngày\s*)?(\d{1,2})\s*(?:tháng|thang)\s*(\d{1,2})\s*(?:năm|nam)?\s*(\d{4})/i.exec(s);
  if (m) return makeIso(Number(m[3]), Number(m[2]), Number(m[1]));

  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return makeIso(Number(m[1]), Number(m[2]), Number(m[3]));

  return null;
}

/** Phát hiện thứ tự ngày/tháng của một tập chuỗi (mặc định kiểu Việt Nam dd/mm). */
export function detectDateOrder(samples: string[]): DateOrder {
  let dmy = 0;
  let mdy = 0;
  for (const s of samples) {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:[^\d].*)?$/.exec(s.trim());
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dmy++;
    else if (b > 12 && a <= 12) mdy++;
  }
  return mdy > 0 && dmy === 0 ? "mdy" : "dmy";
}

// ---------------------------------------------------------------- tính toán ngày (YYYY-MM-DD)

export function isoToMs(iso: string): number {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  return Date.UTC(y, m - 1, d);
}

/** Số ngày a - b. */
export function dayDiff(a: string, b: string): number {
  return Math.round((isoToMs(a) - isoToMs(b)) / 86_400_000);
}

/** 0 = Chủ nhật ... 6 = Thứ bảy */
export function dayOfWeek(iso: string): number {
  return new Date(isoToMs(iso)).getUTCDay();
}

export function addDays(iso: string, days: number): string {
  const dt = new Date(isoToMs(iso) + days * 86_400_000);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function todayIso(): string {
  const dt = new Date();
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}
