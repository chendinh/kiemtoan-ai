// Bộ máy kiểm toán: gom bản ghi từ các file, chạy toàn bộ luật, xếp hạng phát hiện, tính điểm rủi ro.

import type {
  AiDigest,
  AnalysisResult,
  AuditRecord,
  AuditSettings,
  FileSummary,
  Finding,
  ParsedFile,
  RiskLevel,
  RoleSetting,
  Severity,
  SourceRole,
} from "@/lib/types";
import { type ShopAuditOutput, shopAudit, summarizeTabs } from "@/lib/shop/audit";
import type { ShopSummary } from "@/lib/shop/types";
import { partyKey } from "@/lib/util/text";
import { monthOf } from "@/lib/util/values";
import { backdatedRule, dateRangeRules, weekendHolidayRule } from "./rules/dates";
import { balanceRule } from "./rules/balance";
import { benfordRule } from "./rules/benford";
import { duplicateRules } from "./rules/duplicates";
import { hiddenContentRule, metadataRule, rowArithmeticRule } from "./rules/integrity";
import { keywordRule } from "./rules/keywords";
import { outlierRule, roundAmountRule, splitRule, thresholdBunchingRule } from "./rules/amounts";
import { partyRules } from "./rules/parties";
import { reconciliationRules } from "./rules/reconcile";
import { sequenceGapRule } from "./rules/sequence";
import { totalsRule } from "./rules/totals";
import { type FindingDraft, ROLE_PRIORITY, type RuleContext, SigRegistry, toFinding } from "./shared";

export interface EngineInput {
  files: ParsedFile[];
  roleSettings: RoleSetting[];
  settings: AuditSettings;
  /** Ngày hiện tại (YYYY-MM-DD), truyền vào để kết quả xác định được. */
  today: string;
}

const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1, info: 0 };
const SEVERITY_WEIGHT: Record<Severity, number> = { high: 12, medium: 5, low: 1.5, info: 0 };
const MAX_RECORDS_RETURNED = 3000;

function riskLevelOf(score: number): RiskLevel {
  if (score < 15) return "low";
  if (score < 40) return "medium";
  if (score < 65) return "high";
  return "critical";
}

function safe(name: string, drafts: FindingDraft[], fn: () => FindingDraft[]): void {
  try {
    drafts.push(...fn());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    drafts.push({
      rule: "rule_error",
      severity: "info",
      title: `Luật "${name}" gặp lỗi và bị bỏ qua`,
      description: msg,
      records: [],
      amount: 0,
    });
  }
}

/** Chạy lớp kiểm tiền shop; lỗi được ghi thành một phát hiện thay vì làm hỏng cả lần phân tích. */
function safeShop(drafts: FindingDraft[], fn: () => ShopAuditOutput): ShopSummary | undefined {
  try {
    const r = fn();
    drafts.push(...r.drafts);
    return r.summary;
  } catch (e) {
    drafts.push({
      rule: "rule_error",
      severity: "info",
      title: "Lớp kiểm tiền của shop gặp lỗi và bị bỏ qua",
      description: e instanceof Error ? e.message : String(e),
      records: [],
      amount: 0,
    });
    return undefined;
  }
}

function buildDigest(records: AuditRecord[], files: ParsedFile[], roles: Map<string, SourceRole>): AiDigest {
  const positive = records.filter((r) => r.amount > 0);

  const parties = new Map<string, { names: Map<string, number>; count: number; total: number }>();
  for (const r of positive) {
    const key = partyKey(r.counterparty);
    if (!key || !r.counterparty) continue;
    let p = parties.get(key);
    if (!p) {
      p = { names: new Map(), count: 0, total: 0 };
      parties.set(key, p);
    }
    p.names.set(r.counterparty, (p.names.get(r.counterparty) ?? 0) + 1);
    p.count++;
    p.total += r.amount;
  }
  const topCounterparties = [...parties.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 15)
    .map((p) => ({
      name: [...p.names.entries()].sort((a, b) => b[1] - a[1])[0][0],
      count: p.count,
      total: p.total,
    }));

  const monthly = new Map<string, { count: number; total: number }>();
  for (const r of positive) {
    if (!r.date) continue;
    const m = monthOf(r.date);
    const cur = monthly.get(m) ?? { count: 0, total: 0 };
    cur.count++;
    cur.total += r.amount;
    monthly.set(m, cur);
  }

  const largest = [...positive].sort((a, b) => b.amount - a.amount).slice(0, 15);

  const sorted = [...positive].sort((a, b) => a.id.localeCompare(b.id));
  const step = Math.max(1, Math.floor(sorted.length / 30));
  const sample: AuditRecord[] = [];
  for (let i = 0; i < sorted.length && sample.length < 30; i += step) sample.push(sorted[i]);

  const textExcerpts: AiDigest["textExcerpts"] = [];
  let budget = 8000;
  for (const f of files) {
    if (!f.textExcerpt || budget <= 0) continue;
    const excerpt = f.textExcerpt.slice(0, Math.min(2500, budget));
    budget -= excerpt.length;
    textExcerpts.push({ fileId: f.fileId, role: roles.get(f.fileId) ?? f.guessedRole, excerpt });
  }

  return {
    topCounterparties,
    monthly: [...monthly.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, v]) => ({ month, ...v })),
    largest,
    sample,
    textExcerpts,
  };
}

export function runAudit(input: EngineInput): AnalysisResult {
  const { files, settings, today } = input;

  // ---- gán vai trò cuối cùng
  const fileRoles = new Map<string, SourceRole>();
  files.forEach((f, i) => {
    const setting = input.roleSettings[i] ?? "auto";
    fileRoles.set(f.fileId, setting === "auto" ? f.guessedRole : setting);
  });
  const records: AuditRecord[] = [];
  for (const f of files) {
    const role = fileRoles.get(f.fileId) as SourceRole;
    for (const r of f.records) {
      r.role = role;
      records.push(r);
    }
  }
  const positive = records.filter((r) => r.amount > 0);
  const roles = ROLE_PRIORITY.filter((role) => positive.some((r) => r.role === role));
  const ctx: RuleContext = {
    records,
    positive,
    files,
    settings,
    today,
    roles,
    byId: new Map(records.map((r) => [r.id, r])),
    fileRoles,
  };

  // ---- chạy luật
  const drafts: FindingDraft[] = [];
  const registry = new SigRegistry();
  let benford: ReturnType<typeof benfordRule> = { drafts: [], results: [], skipped: [] };
  let recon: ReturnType<typeof reconciliationRules> = { drafts: [], summaries: [] };

  // Chế độ shop ký gửi: sao kê của shop là hàng nghìn khoản chuyển nhỏ từ khách, nên các luật thống kê (Benford, số tiền tròn,
  // ngày nghỉ, giá trị lớn, tách nhỏ, dồn sát ngưỡng, tên giống nhau, từ khóa, siêu dữ liệu) báo động giả hàng loạt.
  // Việc đối chiếu thật sự do lớp kiểm tiền của shop đảm nhiệm.
  const shopMode = settings.shopMode !== false;
  const shop = shopMode ? safeShop(drafts, () => shopAudit({ files, records, today })) : undefined;

  safe("Trùng lặp", drafts, () => duplicateRules(ctx));
  safe("Đối chiếu", drafts, () => {
    recon = reconciliationRules(ctx);
    return recon.drafts;
  });
  safe("Số dư lũy kế", drafts, () => balanceRule(ctx));
  safe("Dòng tổng cộng", drafts, () => totalsRule(ctx));
  safe("Sai số học chứng từ", drafts, () => rowArithmeticRule(ctx));
  safe("Nội dung ẩn", drafts, () => hiddenContentRule(ctx));
  safe("Dãy số chứng từ", drafts, () => sequenceGapRule(ctx));
  safe("Lùi ngày chứng từ", drafts, () => backdatedRule(ctx));
  safe("Khoảng ngày", drafts, () => dateRangeRules(ctx));
  if (!shopMode) {
    safe("Siêu dữ liệu", drafts, () => metadataRule(ctx));
    safe("Tách nhỏ giao dịch", drafts, () => splitRule(ctx, registry));
    safe("Dồn sát ngưỡng", drafts, () => thresholdBunchingRule(ctx, registry));
    safe("Đối tác", drafts, () => partyRules(ctx));
    safe("Giá trị bất thường", drafts, () => outlierRule(ctx, registry));
    safe("Ngày nghỉ/lễ", drafts, () => weekendHolidayRule(ctx, registry));
    safe("Số tiền tròn", drafts, () => roundAmountRule(ctx));
    safe("Benford", drafts, () => {
      benford = benfordRule(ctx);
      return benford.drafts;
    });
    safe("Từ khóa rủi ro", drafts, () => keywordRule(ctx));
  }

  // ---- xếp hạng
  const findings: Finding[] = drafts
    .map((d) => toFinding(d))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.amount - a.amount)
    .map((f, i) => ({ ...f, id: `FD-${String(i + 1).padStart(3, "0")}` }));

  const severityCounts: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 };
  let weighted = 0;
  for (const f of findings) {
    severityCounts[f.severity]++;
    weighted += SEVERITY_WEIGHT[f.severity];
  }
  const riskScore = Math.round(100 * (1 - Math.exp(-weighted / 60)));

  // ---- tóm tắt file
  const fileSummaries: FileSummary[] = files.map((f, i) => {
    const recs = f.records;
    const dates = recs.map((r) => r.date).filter((d): d is string => !!d).sort();
    // File bảng lô, sổ thu chi, báo cáo tháng, file hệ thống được đọc theo từng bảng nghiệp vụ nên không có dòng giao dịch chung.
    const shopTables = f.shop ? summarizeTabs(f.shop) : [];
    return {
      fileId: f.fileId,
      fileName: f.fileName,
      kind: f.kind,
      sizeBytes: f.sizeBytes,
      role: fileRoles.get(f.fileId) as SourceRole,
      guessedRole: f.guessedRole,
      roleSetting: input.roleSettings[i] ?? "auto",
      records: recs.length,
      rowsSkipped: f.rowsSkipped,
      sheets: f.sheets,
      warnings: f.warnings,
      dateFrom: dates[0],
      dateTo: dates[dates.length - 1],
      totalDebit: recs.reduce((s, r) => s + (r.debit ?? 0), 0),
      totalCredit: recs.reduce((s, r) => s + (r.credit ?? 0), 0),
      totalAmount: recs.reduce((s, r) => s + r.amount, 0),
      error: f.error,
      ...(shopTables.length > 0 ? { shopTables, shopUnknownTabs: f.shop?.unknown.length ?? 0 } : {}),
    };
  });

  const allDates = records.map((r) => r.date).filter((d): d is string => !!d).sort();

  // ---- danh sách dòng trả về (cắt bớt để giảm dung lượng)
  const withRecords = files.filter((f) => f.records.length > 0).length || 1;
  const perFile = Math.ceil(MAX_RECORDS_RETURNED / withRecords);
  const returned: AuditRecord[] = [];
  for (const f of files) returned.push(...f.records.slice(0, perFile));

  return {
    generatedAt: new Date().toISOString(),
    settings,
    files: fileSummaries,
    totals: {
      records: records.length,
      debit: records.reduce((s, r) => s + (r.debit ?? 0), 0),
      credit: records.reduce((s, r) => s + (r.credit ?? 0), 0),
      amount: records.reduce((s, r) => s + r.amount, 0),
      dateFrom: allDates[0],
      dateTo: allDates[allDates.length - 1],
    },
    findings,
    severityCounts,
    benford: benford.results,
    benfordSkipped: benford.skipped,
    reconciliation: recon.summaries,
    riskScore,
    riskLevel: riskLevelOf(riskScore),
    digest: buildDigest(records, files, fileRoles),
    records: returned,
    recordsTruncated: returned.length < records.length,
    shop: shop && (shop.checks.length > 0 || shop.sources.length > 0) ? shop : undefined,
  };
}
