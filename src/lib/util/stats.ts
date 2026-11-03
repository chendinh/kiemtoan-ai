// Thống kê cơ bản và định dạng số tiền cho mô tả phát hiện.

export function sum(values: number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

export function mean(values: number[]): number {
  return values.length ? sum(values) / values.length : 0;
}

export function sortedCopy(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

/** Phân vị q (0..1) trên mảng ĐÃ SẮP XẾP, nội suy tuyến tính. */
export function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function median(values: number[]): number {
  return quantileSorted(sortedCopy(values), 0.5);
}

/** Median absolute deviation. */
export function mad(values: number[], med = median(values)): number {
  return median(values.map((v) => Math.abs(v - med)));
}

const nf = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });

/** Định dạng số tiền kiểu Việt Nam: 1.234.567 */
export function fmtMoney(n: number): string {
  return nf.format(Math.round(n * 100) / 100);
}

export function fmtPct(p: number, digits = 1): string {
  return `${(p * 100).toFixed(digits).replace(".", ",")}%`;
}

/** dd/mm/yyyy từ YYYY-MM-DD */
export function fmtDate(iso: string | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
