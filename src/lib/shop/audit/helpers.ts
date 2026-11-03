// Tiện ích dùng chung cho các phép kiểm tiền: dựng dòng bằng chứng, gom kết quả theo tháng, mức độ.

import type { FindingDraft } from "@/lib/audit/shared";
import type { EvidenceRow, Severity } from "@/lib/types";
import { fmtDate, fmtMoney } from "@/lib/util/stats";
import type { CheckStatus, ShopCheck, ShopCoverageItem, ShopFigure, SrcRef } from "../types";

export const vnd = (n: number): string => fmtMoney(n);
export const dmy = (iso: string | undefined): string => (iso ? fmtDate(iso) : "(không có ngày)");

export interface ModuleOut {
  drafts: FindingDraft[];
  checks: ShopCheck[];
  figures: ShopFigure[];
  coverage: ShopCoverageItem[];
}

export const emptyOut = (): ModuleOut => ({ drafts: [], checks: [], figures: [], coverage: [] });

export function mergeInto(target: ModuleOut, part: ModuleOut): void {
  target.drafts.push(...part.drafts);
  target.checks.push(...part.checks);
  target.figures.push(...part.figures);
  target.coverage.push(...part.coverage);
}

/** Tạo dòng bằng chứng tổng hợp (không phải một dòng giao dịch thật của file). */
export class Ev {
  private n = 0;
  row(
    src: SrcRef,
    row: number,
    p: Partial<Omit<EvidenceRow, "id" | "fileId" | "fileName" | "sheet" | "row">> & { amount: number },
  ): EvidenceRow {
    return { role: "ledger", ...p, id: `SH-${String(++this.n).padStart(4, "0")}`, fileId: src.fileId, fileName: src.fileName, sheet: src.sheet, row };
  }
}

export function monthOfIso(iso: string | undefined, year: number): number | null {
  if (!iso || Number(iso.slice(0, 4)) !== year) return null;
  const m = Number(iso.slice(5, 7));
  return m >= 1 && m <= 12 ? m : null;
}

/** Mức độ theo tổng tiền lệch: từ ngưỡng `high` trở lên là Cao, từ `mid` là Trung bình, còn lại là Thấp. */
export function severityByAmount(amount: number, high: number, mid: number): Severity {
  if (amount >= high) return "high";
  if (amount >= mid) return "medium";
  return "low";
}

export const SEV_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1, info: 0 };
export const maxSeverity = (a: Severity, b: Severity): Severity => (SEV_RANK[a] >= SEV_RANK[b] ? a : b);

/** Gom kết quả một phép kiểm theo tháng. `judged` đánh dấu tháng có dữ liệu để kiểm, `issue` ghi nhận một mục lệch. */
export class CheckBuilder {
  private months: ShopCheck["months"] = {};
  private issues = 0;
  private amount = 0;
  private judgedCount = 0;

  constructor(
    private id: string,
    private group: ShopCheck["group"],
    private label: string,
  ) {}

  /** Ghi nhận tháng này có dữ liệu để kiểm; `n` là số mục đã xét (0 nếu chỉ đánh dấu tháng). */
  judged(month: number | null, n = 1): void {
    this.judgedCount += n;
    if (month === null) return;
    this.months[month] ??= { status: "ok", issues: 0, amount: 0 };
    if (this.judgedCount === 0) this.judgedCount = 1;
  }

  issue(month: number | null, amount = 0): void {
    this.issues++;
    this.amount += amount;
    if (month === null) return;
    const m = (this.months[month] ??= { status: "ok", issues: 0, amount: 0 });
    m.status = "issue";
    m.issues++;
    m.amount += amount;
  }

  get hasIssues(): boolean {
    return this.issues > 0;
  }

  build(detail: string): ShopCheck {
    const status: CheckStatus = this.issues > 0 ? "issue" : this.judgedCount > 0 ? "ok" : "na";
    return { id: this.id, group: this.group, label: this.label, status, issues: this.issues, amount: this.amount, detail, months: this.months };
  }
}

/** Thông tin các mô-đun kiểm dùng chung với nhau trong một lần chạy. */
export interface Shared {
  ev: Ev;
  /** Khóa lô đã bị báo "dòng chuyển khoản trùng": không báo lần nữa ở các phép kiểm khác. */
  dupKeys: Set<string>;
}

export const MAX_ROWS = 60;

export function topByAmount<T extends { amount: number }>(rows: T[], n = MAX_ROWS): T[] {
  return [...rows].sort((a, b) => b.amount - a.amount).slice(0, n);
}

export const sum = (xs: number[]): number => xs.reduce((s, x) => s + x, 0);
