// So dòng "Tổng cộng" khai báo trong file với tổng tính lại từ các dòng chi tiết.

import type { AuditRecord, DeclaredTotal, EvidenceRow } from "@/lib/types";
import { fmtMoney } from "@/lib/util/stats";
import { type FindingDraft, type RuleContext } from "../shared";

type TotalField = "debit" | "credit" | "amount" | "net" | "tax";

const FIELDS: TotalField[] = ["debit", "credit", "amount", "net", "tax"];
const FIELD_LABEL: Record<TotalField, string> = {
  debit: "Nợ/Ghi nợ",
  credit: "Có/Ghi có",
  amount: "Số tiền",
  net: "Tiền chưa thuế",
  tax: "Thuế",
};

function valueOf(r: AuditRecord, f: TotalField): number {
  switch (f) {
    case "debit":
      return r.debit ?? 0;
    case "credit":
      return r.credit ?? 0;
    case "amount":
      return r.signed ?? r.amount;
    case "net":
      return r.net ?? 0;
    case "tax":
      return r.tax ?? 0;
  }
}

const tolOf = (declared: number) => 1 + Math.abs(declared) * 1e-6;

/** Chênh lệch ròng Có − Nợ của các bản ghi [from, to). */
function netCredit(recs: AuditRecord[], from: number, to: number): number {
  let s = 0;
  for (let i = from; i < to && i < recs.length; i++) s += (recs[i].credit ?? 0) - (recs[i].debit ?? 0);
  return s;
}

interface Mismatch {
  total: DeclaredTotal;
  field: TotalField;
  declared: number;
  computed: number;
}

export function totalsRule(ctx: RuleContext): FindingDraft[] {
  const out: FindingDraft[] = [];

  for (const f of ctx.files) {
    if (f.declaredTotals.length === 0) continue;
    const role = ctx.fileRoles.get(f.fileId) ?? f.guessedRole;
    const groupKey = (sheet: string | undefined) => (f.kind === "pdf" ? "" : sheet ?? "");

    const recsByGroup = new Map<string, AuditRecord[]>();
    for (const r of ctx.records) {
      if (r.fileId !== f.fileId) continue;
      const k = groupKey(r.sheet);
      const g = recsByGroup.get(k);
      if (g) g.push(r);
      else recsByGroup.set(k, [r]);
    }
    const totalsByGroup = new Map<string, DeclaredTotal[]>();
    for (const t of f.declaredTotals) {
      const k = groupKey(t.sheet);
      const g = totalsByGroup.get(k);
      if (g) g.push(t);
      else totalsByGroup.set(k, [t]);
    }

    const mismatches: Mismatch[] = [];
    for (const [key, totals] of totalsByGroup) {
      const recs = recsByGroup.get(key) ?? [];
      totals.forEach((t, idx) => {
        const prev = totals.slice(0, idx);
        const start = prev.length ? prev[prev.length - 1].recordCountBefore : 0;
        for (const field of FIELDS) {
          const declared = t[field];
          if (declared === undefined) continue;
          let since = 0;
          for (let i = start; i < t.recordCountBefore && i < recs.length; i++) since += valueOf(recs[i], field);
          let all = 0;
          for (let i = 0; i < t.recordCountBefore && i < recs.length; i++) all += valueOf(recs[i], field);
          const subtotals = prev.reduce((s, p) => s + (p[field] ?? 0), 0);
          const tol = tolOf(declared);
          // Dòng "Tổng số / Total" của sao kê Vietcombank chỉ có một con số: chênh lệch ròng Có − Nợ
          // (có thể âm). Chỉ chấp nhận cách đọc này khi dòng tổng khai báo một phía.
          const oneSided = (field === "credit" || field === "debit") && (t.debit === undefined || t.credit === undefined);
          const netOk =
            oneSided &&
            [netCredit(recs, start, t.recordCountBefore), netCredit(recs, 0, t.recordCountBefore)].some(
              (n) => Math.abs(n - declared) <= tol || Math.abs(n + declared) <= tol,
            );
          const ok = netOk || [since, all, subtotals].some((s) => Math.abs(s - declared) <= tol);
          if (!ok) mismatches.push({ total: t, field, declared, computed: prev.length ? since : all });
        }
      });
    }
    if (mismatches.length === 0) continue;

    const evidence: EvidenceRow[] = mismatches.slice(0, 60).map((m, i) => ({
      id: `TOT-${f.fileId}-${i + 1}`,
      fileId: f.fileId,
      fileName: f.fileName,
      role,
      sheet: m.total.sheet,
      row: m.total.row,
      description: `${m.total.label} (${FIELD_LABEL[m.field]}): khai ${fmtMoney(m.declared)}, tính lại ${fmtMoney(m.computed)}`,
      amount: Math.abs(m.declared - m.computed),
      note: `Lệch ${fmtMoney(m.declared - m.computed)}`,
    }));
    const biggest = Math.max(...mismatches.map((m) => Math.abs(m.declared - m.computed)));
    out.push({
      rule: "total_mismatch",
      severity: "high",
      title: "Dòng tổng cộng không khớp với chi tiết",
      description: `File ${f.fileName}: ${mismatches.length} số tổng khai báo khác với tổng tính lại từ các dòng chi tiết (lệch lớn nhất ${fmtMoney(biggest)}). Tổng bị sửa tay, dòng chi tiết bị xóa/ẩn hoặc thêm bớt sau khi lập tổng đều gây ra hiện tượng này.`,
      recommendation: "Mở file gốc, kiểm tra công thức ở ô tổng (có phải số gõ tay không), hàng bị ẩn/lọc và các dòng thêm sau cùng.",
      records: [],
      evidenceOverride: evidence,
      amount: biggest,
    });
  }
  return out;
}
