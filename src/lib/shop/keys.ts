// Khóa lô ký gửi: chuẩn hóa mã khách, đọc "đợt" (tháng-năm trả tiền) và mã lô của hệ thống.

export interface BatchInfo {
  year: number;
  month: number;
}

/** Mã khách ký gửi chuẩn hóa: số thuần được đệm 0 ("4" → "004"), chữ viết hoa bỏ khoảng trắng ("301 + 302" → "301+302"). */
export function normCode(v: unknown): string {
  const s = String(v ?? "")
    .replace(/[\s\u00a0\u202f]+/g, "")
    .trim();
  if (/^\d+$/.test(s)) return s.padStart(3, "0");
  return s.toUpperCase();
}

export function lotKey(code: string, batch: string): string {
  return `${code}|${batch}`;
}

/** "926" → tháng 9/2026; "1225" → 12/2025; "1124b" → 11/2024; "MTM" → null. */
export function parseBatch(batch: string): BatchInfo | null {
  const d = batch.trim().replace(/[a-z]+$/i, "");
  if (!/^\d{3,4}$/.test(d)) return null;
  const month = Number(d.length === 3 ? d.slice(0, 1) : d.slice(0, 2));
  const yy = Number(d.slice(-2));
  if (month < 1 || month > 12 || yy < 15 || yy > 45) return null;
  return { year: 2000 + yy, month };
}

export function batchLabel(batch: string): string {
  const b = parseBatch(batch);
  return b ? `${String(b.month).padStart(2, "0")}/${b.year}` : batch;
}

export function batchSortKey(batch: string): number {
  const b = parseBatch(batch);
  return b ? b.year * 100 + b.month : Number.MAX_SAFE_INTEGER;
}

export function inYear(batch: string, year: number): boolean {
  return parseBatch(batch)?.year === year;
}

export interface GaKey {
  code: string;
  batch: string;
  test: boolean;
}

/**
 * Mã KG của hệ thống có dạng "278-326", nhưng người dùng hay gõ thêm ghi chú sau mã
 * (số tài khoản, "đã trả", "test-store"...). Chỉ lấy phần mã và đợt; phần ghi chú bị bỏ, không lưu.
 */
export function parseGaKey(raw: string): GaKey | null {
  const s = raw.replace(/[\s\u00a0\u202f]+/g, " ").trim();
  const dash = s.indexOf("-");
  if (dash <= 0) return null;
  const left = s.slice(0, dash).replace(/\s+/g, "");
  if (!/^[A-Za-z]{0,4}\d{0,4}[A-Za-z]?$/.test(left) || left === "") return null;
  const rest = s.slice(dash + 1).trim();
  const m = /^([A-Za-z0-9]+)/.exec(rest);
  if (!m) return null;
  const test = /test|qa/i.test(s);
  return { code: normCode(left), batch: m[1].toUpperCase() === "MTM" ? "MTM" : m[1], test };
}
