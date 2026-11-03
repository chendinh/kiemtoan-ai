// Hạ tầng dùng chung cho các luật: ngữ cảnh, bản nháp phát hiện, đăng ký chữ ký giao dịch.

import type {
  AuditRecord,
  AuditSettings,
  EvidenceRow,
  Finding,
  ParsedFile,
  RuleId,
  Severity,
  SourceRole,
} from "@/lib/types";
import { sum } from "@/lib/util/stats";

export interface RuleContext {
  /** Mọi bản ghi (đã gán vai trò cuối cùng). */
  records: AuditRecord[];
  /** Bản ghi có số tiền > 0. */
  positive: AuditRecord[];
  files: ParsedFile[];
  settings: AuditSettings;
  today: string;
  /** Các vai trò có dữ liệu, theo thứ tự ưu tiên xử lý. */
  roles: SourceRole[];
  /** Tra nhanh bản ghi theo id. */
  byId: Map<string, AuditRecord>;
  /** Vai trò cuối cùng của từng file (fileId -> role). */
  fileRoles: Map<string, SourceRole>;
}

export interface FindingDraft {
  rule: RuleId;
  severity: Severity;
  title: string;
  description: string;
  recommendation?: string;
  records: AuditRecord[];
  notes?: Map<string, string>;
  /** Ghi đè danh sách bằng chứng (ví dụ dòng tổng cộng tổng hợp). */
  evidenceOverride?: EvidenceRow[];
  /** Tổng số mục thực tế khi `evidenceOverride` đã bị cắt bớt. */
  total?: number;
  amount?: number;
  meta?: Finding["meta"];
}

export const MAX_EVIDENCE = 60;
const MAX_IDS = 500;

export const ROLE_PRIORITY: SourceRole[] = ["bank", "ledger", "invoice", "other"];

export function toFinding(d: FindingDraft): Omit<Finding, "id"> {
  const seen = new Set<string>();
  const uniq: AuditRecord[] = [];
  for (const r of d.records) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    uniq.push(r);
  }
  const evidence: EvidenceRow[] =
    d.evidenceOverride ??
    uniq.slice(0, MAX_EVIDENCE).map((r) => {
      const note = d.notes?.get(r.id);
      return note ? { ...r, note } : { ...r };
    });
  return {
    rule: d.rule,
    severity: d.severity,
    title: d.title,
    description: d.description,
    recommendation: d.recommendation,
    amount: d.amount ?? sum(uniq.map((r) => r.amount)),
    totalRecords: d.total ?? (d.evidenceOverride ? d.evidenceOverride.length : uniq.length),
    evidence,
    recordIds: uniq.slice(0, MAX_IDS).map((r) => r.id),
    meta: d.meta,
  };
}

/** Phía của giao dịch: Nợ/Có hoặc dấu của số có dấu. */
export function sideOf(r: AuditRecord): string {
  if ((r.debit ?? 0) !== 0 && (r.credit ?? 0) === 0) return "D";
  if ((r.credit ?? 0) !== 0 && (r.debit ?? 0) === 0) return "C";
  if (r.signed !== undefined) return r.signed < 0 ? "N" : "P";
  return "-";
}

/**
 * Chữ ký giao dịch để nhận ra cùng một giao dịch xuất hiện ở nhiều nguồn.
 * Dùng số tiền + tháng (không dùng ngày) vì ngày ghi sổ, ngày hóa đơn và ngày ngân hàng thường lệch nhau vài ngày.
 */
export function txSignature(r: AuditRecord): string {
  return `${(r.date ?? "").slice(0, 7)}|${Math.round(r.amount)}`;
}

/** Ghi nhớ giao dịch đã được báo để không báo lặp ở nguồn khác (sổ sách và sao kê cùng chứa một giao dịch). */
export class SigRegistry {
  private seen = new Set<string>();

  /** Tỷ lệ bản ghi đã được báo trước đó. */
  overlap(records: AuditRecord[]): number {
    if (records.length === 0) return 0;
    let hit = 0;
    for (const r of records) if (this.seen.has(txSignature(r))) hit++;
    return hit / records.length;
  }

  claim(records: AuditRecord[]): void {
    for (const r of records) this.seen.add(txSignature(r));
  }
}

export function recordsOfRole(ctx: RuleContext, role: SourceRole): AuditRecord[] {
  return ctx.positive.filter((r) => r.role === role);
}

export function roleLabelShort(role: SourceRole): string {
  switch (role) {
    case "ledger":
      return "sổ sách";
    case "bank":
      return "sao kê";
    case "invoice":
      return "hóa đơn";
    default:
      return "tài liệu khác";
  }
}

export function plural(n: number, noun: string): string {
  return `${n.toLocaleString("vi-VN")} ${noun}`;
}

export function maxThreshold(settings: AuditSettings): number {
  return settings.thresholds.length ? Math.max(...settings.thresholds) : Infinity;
}

export function sortByAmountDesc(records: AuditRecord[]): AuditRecord[] {
  return [...records].sort((a, b) => b.amount - a.amount);
}
