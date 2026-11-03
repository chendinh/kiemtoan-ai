// Cấu hình riêng của shop GIVE AWAY PREMIUM. Đây là nơi duy nhất chứa các quy ước của shop (năm kiểm, đơn vị tiền).

import { SHOP_FROM, SHOP_YEAR } from "./period";

export const SHOP = {
  name: "GIVE AWAY PREMIUM",
  /** Năm kiểm tiền. Chỉ dữ liệu từ ngày `from` trở đi được đưa vào các luật kiểm tiền. */
  year: SHOP_YEAR,
  from: SHOP_FROM,
  /** Số nhân để đổi đơn vị ghi trong từng loại bảng ra đồng. */
  unit: {
    /** Bảng ký gửi theo lô: "Tổng trả khách" ghi bằng nghìn đồng. */
    lots: 1000,
    /** Danh sách chuyển khoản: "TỔNG TIỀN" ghi bằng nghìn đồng. */
    payouts: 1000,
    /** Doanh thu ngày: chi phí và tiền mặt thường ghi bằng nghìn đồng (xem toVnd). */
    expenseCash: 1000,
  },
  /** Mã lô gộp nhiều khách nhỏ trong danh sách chuyển khoản. */
  bulkCodes: ["TH"],
  /** Ngưỡng phân biệt đơn vị: ô nhỏ hơn mức này (đồng) được hiểu là nghìn đồng. */
  thousandThreshold: 100_000,
  /** Dung sai khi so số tiền giữa các nguồn (đồng). */
  tolerance: 1_000,
  /** Hạn trả khách là ngày này của tháng đợt (hệ thống ghi "Hẹn trả tiền" ngày 20 ở 94% đơn). */
  dueDay: 20,
  /**
   * Tên người quản lý nhận tiền từ chủ shop để chi trả khách (chữ thường, không dấu).
   * Dùng để tìm các lệnh chuyển cho quản lý trên sao kê và ghép với cột "đã nhận" của sổ thu chi.
   */
  managerNames: ["truong ngoc linh"],
  /** Số ngày lệch tối đa khi ghép khoản nhận trong sổ với lệnh chuyển trên sao kê. */
  bankWindowDays: 3,
  /** Doanh thu ngày lệch quá mức này (đồng) so với tổng các hình thức thu thì báo. */
  revenueTolerance: 5_000,
} as const;

/** Mã lô gộp nhiều khách nhỏ: "TH" và các biến thể đánh số của hệ thống ("TH1", "TH2"...). */
export function isBulkCode(code: string): boolean {
  const c = code.toUpperCase();
  return SHOP.bulkCodes.some((b) => c === b || new RegExp(`^${b}\\d+$`).test(c));
}

/** Đổi giá trị ô ghi theo "nghìn đồng hoặc đồng tùy tháng" ra đồng. */
export function toVnd(v: number): { vnd: number; guessed: boolean } {
  if (v === 0) return { vnd: 0, guessed: false };
  return v >= SHOP.thousandThreshold ? { vnd: v, guessed: false } : { vnd: v * SHOP.unit.expenseCash, guessed: true };
}

/** Che các dãy từ 8 chữ số trở lên (số tài khoản, số điện thoại) trong chữ tự do trước khi hiển thị hoặc gửi đi. */
export function maskDigits(s: string): string {
  return s.replace(/\d{8,}/g, (m) => `***${m.slice(-3)}`);
}

/** Ghi chú ngắn gọn, đã che số dài. */
export function cleanNote(s: string, max = 80): string {
  const t = maskDigits(s.replace(/[\s\u00a0\u202f]+/g, " ").trim());
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
