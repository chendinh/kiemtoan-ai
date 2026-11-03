// Chuyển đổi giữa biểu mẫu cài đặt (chuỗi người dùng nhập) và AuditSettings gửi lên server.

import { SHOP_FROM } from "@/lib/shop/period";
import { type AuditSettings, DEFAULT_SETTINGS } from "@/lib/types";
import { fmtMoney } from "@/lib/util/stats";
import { parseNumber } from "@/lib/util/values";

export interface SettingsForm {
  thresholds: string;
  band: string;
  tolerance: string;
  dateWindow: string;
  splitWindow: string;
  duplicateWindow: string;
  minAmount: string;
  roundUnit: string;
  periodFrom: string;
  periodTo: string;
  keywords: string;
  /** Chế độ shop ký gửi: chạy lớp kiểm tiền của shop và tắt các luật thống kê hay báo động giả trên dữ liệu của shop. */
  shopMode: boolean;
}

export const DEFAULT_FORM: SettingsForm = {
  thresholds: DEFAULT_SETTINGS.thresholds.map(fmtMoney).join("; "),
  band: String(DEFAULT_SETTINGS.thresholdBandPct),
  tolerance: String(DEFAULT_SETTINGS.amountTolerance),
  dateWindow: String(DEFAULT_SETTINGS.dateWindowDays),
  splitWindow: String(DEFAULT_SETTINGS.splitWindowDays),
  duplicateWindow: String(DEFAULT_SETTINGS.duplicateWindowDays),
  minAmount: fmtMoney(DEFAULT_SETTINGS.minAmount),
  roundUnit: fmtMoney(DEFAULT_SETTINGS.roundUnit),
  // Kiểm tiền của shop bắt đầu từ 01/01/2026 đến hiện tại; để trống "đến ngày" nghĩa là không chặn đầu kia.
  periodFrom: SHOP_FROM,
  periodTo: "",
  keywords: "",
  shopMode: DEFAULT_SETTINGS.shopMode !== false,
};

function num(raw: string, fallback: number, min: number, max: number): number {
  const n = parseNumber(raw.trim());
  if (n === null) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function formToSettings(f: SettingsForm): AuditSettings {
  const thresholds = f.thresholds
    .split(/[;\n]+/)
    .map((t) => parseNumber(t.trim()))
    .filter((n): n is number => n !== null && n > 0)
    .slice(0, 12);

  return {
    thresholds: thresholds.length > 0 ? thresholds : DEFAULT_SETTINGS.thresholds,
    thresholdBandPct: num(f.band, DEFAULT_SETTINGS.thresholdBandPct, 0.5, 50),
    amountTolerance: num(f.tolerance, DEFAULT_SETTINGS.amountTolerance, 0, 1_000_000_000),
    dateWindowDays: Math.round(num(f.dateWindow, DEFAULT_SETTINGS.dateWindowDays, 0, 120)),
    splitWindowDays: Math.round(num(f.splitWindow, DEFAULT_SETTINGS.splitWindowDays, 0, 30)),
    duplicateWindowDays: Math.round(num(f.duplicateWindow, DEFAULT_SETTINGS.duplicateWindowDays, 0, 60)),
    minAmount: num(f.minAmount, DEFAULT_SETTINGS.minAmount, 0, 1_000_000_000_000),
    roundUnit: num(f.roundUnit, DEFAULT_SETTINGS.roundUnit, 1, 1_000_000_000_000),
    periodFrom: /^\d{4}-\d{2}-\d{2}$/.test(f.periodFrom) ? f.periodFrom : undefined,
    periodTo: /^\d{4}-\d{2}-\d{2}$/.test(f.periodTo) ? f.periodTo : undefined,
    keywords: f.keywords
      .split(/[;\n,]+/)
      .map((k) => k.trim())
      .filter(Boolean)
      .slice(0, 30),
    shopMode: f.shopMode,
  };
}
