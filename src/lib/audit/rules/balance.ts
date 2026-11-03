// Kiểm tra số dư lũy kế (sao kê/sổ tiền gửi): số dư sau = số dư trước ± phát sinh.

import type { AuditRecord } from "@/lib/types";
import { fmtMoney } from "@/lib/util/stats";
import { type FindingDraft, type RuleContext } from "../shared";

/** Tác động lên số dư theo quy ước "Có tăng" (sao kê ngân hàng). */
function creditEffect(r: AuditRecord): number | null {
  if (r.debit !== undefined || r.credit !== undefined) return (r.credit ?? 0) - (r.debit ?? 0);
  if (r.signed !== undefined) return r.signed;
  return null;
}

interface Variant {
  name: string;
  /** +1: "Có tăng"; -1: "Nợ tăng" (sổ kế toán của tài khoản tiền) */
  sign: 1 | -1;
  /** true: dòng đầu là cũ nhất; false: dòng đầu là mới nhất */
  forward: boolean;
}

const VARIANTS: Variant[] = [
  { name: "Có tăng, cũ → mới", sign: 1, forward: true },
  { name: "Có tăng, mới → cũ", sign: 1, forward: false },
  { name: "Nợ tăng, cũ → mới", sign: -1, forward: true },
  { name: "Nợ tăng, mới → cũ", sign: -1, forward: false },
];

const TOL = 0.5;

export function balanceRule(ctx: RuleContext): FindingDraft[] {
  const out: FindingDraft[] = [];

  const groups = new Map<string, AuditRecord[]>();
  for (const r of ctx.records) {
    if (r.balance === undefined) continue;
    if (creditEffect(r) === null) continue;
    const key = `${r.fileId}|${r.sheet ?? ""}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  for (const g of groups.values()) {
    if (g.length < 5) continue;

    // Chấm điểm từng cách đọc, chọn cách khớp nhiều nhất.
    let best: { v: Variant; ok: number; tested: number } | null = null;
    for (const v of VARIANTS) {
      let ok = 0;
      let tested = 0;
      for (let i = 1; i < g.length; i++) {
        const cur = v.forward ? g[i] : g[i - 1];
        const eff = (creditEffect(cur) as number) * v.sign;
        const delta = v.forward ? (g[i].balance as number) - (g[i - 1].balance as number) : (g[i - 1].balance as number) - (g[i].balance as number);
        tested++;
        if (Math.abs(delta - eff) <= TOL) ok++;
      }
      if (!best || ok > best.ok) best = { v, ok, tested };
    }
    if (!best || best.tested < 4 || best.ok / best.tested < 0.7) continue;

    const { v } = best;
    const breaks: { rec: AuditRecord; expected: number; actual: number }[] = [];
    for (let i = 1; i < g.length; i++) {
      const cur = v.forward ? g[i] : g[i - 1];
      const eff = (creditEffect(cur) as number) * v.sign;
      if (v.forward) {
        const expected = (g[i - 1].balance as number) + eff;
        if (Math.abs((g[i].balance as number) - expected) > TOL) breaks.push({ rec: g[i], expected, actual: g[i].balance as number });
      } else {
        // g[i-1] là dòng mới hơn: balance(g[i-1]) = balance(g[i]) + eff(g[i-1])
        const expected = (g[i].balance as number) + eff;
        if (Math.abs((g[i - 1].balance as number) - expected) > TOL) breaks.push({ rec: g[i - 1], expected, actual: g[i - 1].balance as number });
      }
    }
    if (breaks.length === 0) continue;

    const notes = new Map<string, string>();
    for (const b of breaks) {
      notes.set(b.rec.id, `Số dư kỳ vọng ${fmtMoney(b.expected)}, trên file ${fmtMoney(b.actual)} (lệch ${fmtMoney(b.actual - b.expected)})`);
    }
    const biggest = breaks.reduce((m, b) => Math.max(m, Math.abs(b.actual - b.expected)), 0);
    out.push({
      rule: "balance_break",
      severity: "high",
      title: "Đứt gãy số dư lũy kế",
      description: `File ${g[0].fileName}${g[0].sheet ? ` (${g[0].sheet})` : ""}: ${best.ok}/${best.tested} dòng khớp công thức số dư (${v.name}), nhưng ${breaks.length} dòng không khớp, chênh lệch lớn nhất ${fmtMoney(biggest)}. Bản sao kê/sổ thật hiếm khi bị đứt số dư; đây là dấu hiệu dòng bị chèn, xóa hoặc sửa số.`,
      recommendation: "Lấy sổ phụ gốc trực tiếp từ ngân hàng (hoặc xác nhận số dư với ngân hàng) và so với file này, tập trung vào các dòng bị đứt.",
      records: breaks.map((b) => b.rec),
      notes,
      amount: biggest,
      meta: { breaks: breaks.length, tested: best.tested },
    });
  }
  return out;
}
