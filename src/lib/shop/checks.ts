// Quan hệ giữa phép kiểm tiền và luật phát hiện, nhãn nhóm và nhóm số liệu. Chỉ chứa hằng số và hàm thuần,
// dùng được ở cả server lẫn giao diện (giao diện dùng để bấm một phép kiểm là lọc ra các phát hiện liên quan).

import type { RuleId } from "@/lib/types";
import type { CheckStatus, ShopCheck, ShopFigure } from "./types";

export type CheckGroup = ShopCheck["group"];

export const GROUP_ORDER: CheckGroup[] = ["lots", "system", "ledger", "bank", "report", "revenue"];

export const GROUP_LABELS: Record<CheckGroup, string> = {
  lots: "Bảng lô và chuyển khoản trả khách",
  system: "Đối chiếu với hệ thống quản lý ký gửi",
  ledger: "Sổ thu chi",
  bank: "Sao kê ngân hàng",
  report: "Báo cáo tháng",
  revenue: "Doanh thu ngày",
};

/** Mỗi phép kiểm sinh ra các phát hiện thuộc những luật nào. Phép kiểm lạ (chưa có trong bảng) không có nút lọc. */
export const CHECK_RULES: Record<string, RuleId[]> = {
  "lots.paid_match": ["lot_amount_mismatch"],
  "lots.unpaid": ["lot_unpaid"],
  "lots.payout_dup": ["payout_duplicate"],
  "lots.payout_orphan": ["payout_orphan"],
  "lots.declared": ["declared_total"],
  "system.paid_match": ["system_mismatch"],
  "system.unpaid_status": ["system_mismatch"],
  "system.missing_order": ["system_mismatch"],
  "system.vs_sheet": ["system_mismatch"],
  "system.totals": ["declared_total"],
  "ledger.footing": ["ledger_footing"],
  "ledger.continuity": ["ledger_continuity"],
  "ledger.entries": ["ledger_entry_issue"],
  "ledger.days": ["day_mismatch"],
  "bank.coverage": ["statement_gap"],
  "bank.chain": ["statement_gap"],
  "bank.ledger": ["bank_ledger_mismatch"],
  "report.owed": ["report_mismatch"],
  "report.ledger": ["report_mismatch"],
  "report.footing": ["report_mismatch"],
  "report.revenue": ["report_mismatch"],
  "revenue.identity": ["revenue_mismatch"],
};

export const STATUS_LABELS: Record<CheckStatus, string> = {
  issue: "Có lệch",
  ok: "Đạt",
  na: "Chưa kiểm được",
};

export interface CheckTally {
  total: number;
  issue: number;
  ok: number;
  na: number;
}

export function tallyChecks(checks: ShopCheck[]): CheckTally {
  const t: CheckTally = { total: checks.length, issue: 0, ok: 0, na: 0 };
  for (const c of checks) t[c.status]++;
  return t;
}

/** Nhóm các phép kiểm theo `group`, giữ thứ tự nhóm cố định và thứ tự phép kiểm như server trả. */
export function groupChecks(checks: ShopCheck[]): { group: CheckGroup; label: string; checks: ShopCheck[] }[] {
  const out: { group: CheckGroup; label: string; checks: ShopCheck[] }[] = [];
  for (const g of GROUP_ORDER) {
    const list = checks.filter((c) => c.group === g);
    if (list.length > 0) out.push({ group: g, label: GROUP_LABELS[g], checks: list });
  }
  // Nhóm lạ (server thêm nhóm mới mà giao diện chưa biết) vẫn được hiển thị.
  const known = new Set<string>(GROUP_ORDER);
  const rest = checks.filter((c) => !known.has(c.group));
  if (rest.length > 0) out.push({ group: rest[0].group, label: "Khác", checks: rest });
  return out;
}

/** Số liệu theo tháng được xếp cạnh những số liệu cùng ý nghĩa để người xem so bằng mắt. */
const FIGURE_GROUPS: { title: string; ids: string[] }[] = [
  { title: "Tổng tiền phải trả khách theo đợt", ids: ["fig.lots_owed", "fig.system_owed", "fig.report_owed", "fig.day_head"] },
  { title: "Tiền nhận và chuyển cho quản lý", ids: ["fig.ledger_recv", "fig.ledger_recv_date", "fig.bank_to_manager", "fig.report_recv"] },
  { title: "Tiền đã trả khách", ids: ["fig.payouts", "fig.ledger_paid", "fig.report_paid"] },
  { title: "Số dư", ids: ["fig.ledger_close", "fig.report_left"] },
  { title: "Doanh thu", ids: ["fig.daily_rev", "fig.report_rev"] },
];

export function groupFigures(figures: ShopFigure[]): { title: string; figures: ShopFigure[] }[] {
  const byId = new Map(figures.map((f) => [f.id, f]));
  const used = new Set<string>();
  const out: { title: string; figures: ShopFigure[] }[] = [];
  for (const g of FIGURE_GROUPS) {
    const list = g.ids.map((id) => byId.get(id)).filter((f): f is ShopFigure => !!f);
    for (const f of list) used.add(f.id);
    if (list.length > 0) out.push({ title: g.title, figures: list });
  }
  const rest = figures.filter((f) => !used.has(f.id));
  if (rest.length > 0) out.push({ title: "Khác", figures: rest });
  return out;
}

export const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
