// Đối chiếu giữa các nguồn: sổ sách ↔ sao kê ngân hàng, hóa đơn ↔ sổ sách (hoặc sao kê).
// Ghép 1-1 theo số tiền + ngày + chứng từ + diễn giải, sau đó ghép nhóm (nhiều ↔ một), rồi báo phần dư và lệch số tiền.

import type { AuditRecord, ReconciliationSummary, Severity, SourceRole } from "@/lib/types";
import { fmtMoney, fmtPct, sum } from "@/lib/util/stats";
import { jaccard, normRef, partyKey, similarity, tokens } from "@/lib/util/text";
import { dayDiff, isoToMs } from "@/lib/util/values";
import { ROLE_LABELS } from "../catalog";
import { type FindingDraft, type RuleContext, maxThreshold, sortByAmountDesc } from "../shared";

const GENERIC_REFS = new Set(["KHONG", "NONE", "NULL", "NIL", "NA", "TIENMAT", "CASH", "NOREF"]);

function strictRef(ref: string | undefined): string | null {
  if (!ref) return null;
  const n = normRef(ref);
  if (n.length < 3 || /^0+$/.test(n) || GENERIC_REFS.has(n)) return null;
  return n;
}

const stripZeros = (s: string) => s.replace(/^0+(?=\d)/, "");
const trailingNumber = (ref: string) => {
  const m = /(\d{3,})$/.exec(ref);
  return m ? stripZeros(m[1]) : null;
};

interface Prepared {
  rec: AuditRecord;
  ref: string | null;
  refNum: string | null;
  toks: string[];
  tokSet: Set<string>;
  party: string | null;
}

function prepare(recs: AuditRecord[]): Prepared[] {
  return recs.map((rec) => {
    const ref = strictRef(rec.reference);
    const toks = tokens(rec.description);
    return {
      rec,
      ref,
      refNum: ref ? trailingNumber(ref) : null,
      toks,
      tokSet: new Set(toks.map((t) => stripZeros(t))),
      party: partyKey(rec.counterparty),
    };
  });
}

interface MatchOptions {
  tolerance: number;
  windowDays: number;
  /** Số hóa đơn (bên trái) xuất hiện trong diễn giải của bên phải. */
  textRefMatch: boolean;
}

interface ReconResult {
  pairs: { l: number; r: number }[];
  groups: { left: number[]; right: number[] }[];
  mismatches: { l: number; r: number; diff: number }[];
  leftUnmatched: number[];
  rightUnmatched: number[];
}

function findSubset(
  target: number,
  items: { idx: number; amt: number }[],
  tol: number,
  maxSize: number,
  budget: { nodes: number },
): number[] | null {
  const sorted = [...items].sort((a, b) => b.amt - a.amt);
  const suffix = new Array<number>(sorted.length + 1).fill(0);
  for (let i = sorted.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + sorted[i].amt;
  const chosen: number[] = [];
  const dfs = (start: number, remaining: number): boolean => {
    if (budget.nodes-- <= 0) return false;
    if (chosen.length >= 2 && Math.abs(remaining) <= tol) return true;
    if (chosen.length >= maxSize) return false;
    for (let i = start; i < sorted.length; i++) {
      if (suffix[i] < remaining - tol) return false;
      const a = sorted[i].amt;
      if (a > remaining + tol) continue;
      chosen.push(i);
      if (dfs(i + 1, remaining - a)) return true;
      chosen.pop();
    }
    return false;
  };
  return dfs(0, target) ? chosen.map((i) => sorted[i].idx) : null;
}

function reconcile(L: Prepared[], R: Prepared[], opts: MatchOptions): ReconResult {
  const tol = Math.max(opts.tolerance, 0.005);
  const usedL = new Set<number>();
  const usedR = new Set<number>();
  const result: ReconResult = { pairs: [], groups: [], mismatches: [], leftUnmatched: [], rightUnmatched: [] };

  // ---- Pass 1: ghép 1-1 theo số tiền (± dung sai) trong cửa sổ ngày
  // Sắp theo (số tiền, ngày) để khi có rất nhiều khoản cùng số tiền vẫn tìm được các khoản gần ngày nhất.
  const sortedR = R.map((p, i) => ({ i, a: p.rec.amount, ms: p.rec.date ? isoToMs(p.rec.date) : Infinity })).sort(
    (x, y) => x.a - y.a || x.ms - y.ms,
  );
  const lowerBound = (v: number): number => {
    let lo = 0;
    let hi = sortedR.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedR[mid].a < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const upperBound = (v: number): number => {
    let lo = 0;
    let hi = sortedR.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedR[mid].a <= v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const MAX_SCAN = 300;

  const candidates: { l: number; r: number; score: number; dd: number }[] = [];
  L.forEach((lp, li) => {
    const found: { l: number; r: number; score: number; dd: number }[] = [];
    let start = lowerBound(lp.rec.amount - tol);
    let end = upperBound(lp.rec.amount + tol);
    if (end - start > MAX_SCAN) {
      // Quá đông ứng viên cùng số tiền: chỉ xét quanh ngày gần nhất.
      const target = lp.rec.date ? isoToMs(lp.rec.date) : Infinity;
      let lo = start;
      let hi = end;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sortedR[mid].ms < target) lo = mid + 1;
        else hi = mid;
      }
      start = Math.max(start, lo - MAX_SCAN / 2);
      end = Math.min(end, start + MAX_SCAN);
    }
    for (let k = start; k < end; k++) {
      const ri = sortedR[k].i;
      const rp = R[ri];
      const dd = lp.rec.date && rp.rec.date ? Math.abs(dayDiff(lp.rec.date, rp.rec.date)) : -1;
      const refEqual = !!(lp.ref && rp.ref && (lp.ref === rp.ref || (lp.refNum && lp.refNum === rp.refNum && lp.refNum.length >= 4)));
      const textRef = opts.textRefMatch && !!lp.refNum && lp.refNum.length >= 3 && rp.tokSet.has(lp.refNum);
      if (dd > opts.windowDays && !refEqual && !textRef) continue;

      let score = 50;
      score -= dd >= 0 ? Math.min(60, dd * 6) : 15;
      if (refEqual) score += 60;
      else if (lp.ref && rp.ref && lp.ref.length >= 4 && rp.ref.length >= 4 && (lp.ref.includes(rp.ref) || rp.ref.includes(lp.ref))) score += 35;
      if (textRef) score += 55;
      score += 30 * jaccard(lp.toks, rp.toks);
      if (lp.party && rp.party && similarity(lp.party, rp.party) >= 0.85) score += 20;
      found.push({ l: li, r: ri, score, dd });
    }
    found.sort((a, b) => b.score - a.score || a.dd - b.dd);
    candidates.push(...found.slice(0, 8));
  });
  candidates.sort((a, b) => b.score - a.score || a.dd - b.dd || a.l - b.l);
  for (const c of candidates) {
    if (usedL.has(c.l) || usedR.has(c.r)) continue;
    usedL.add(c.l);
    usedR.add(c.r);
    result.pairs.push({ l: c.l, r: c.r });
  }

  // ---- Pass 2: cùng số chứng từ nhưng lệch số tiền
  const rByRef = new Map<string, number[]>();
  R.forEach((rp, ri) => {
    if (usedR.has(ri) || !rp.ref) return;
    const g = rByRef.get(rp.ref) ?? [];
    g.push(ri);
    rByRef.set(rp.ref, g);
  });
  L.forEach((lp, li) => {
    if (usedL.has(li) || !lp.ref) return;
    const options = (rByRef.get(lp.ref) ?? []).filter((ri) => !usedR.has(ri));
    if (options.length === 0) return;
    options.sort((a, b) => Math.abs(R[a].rec.amount - lp.rec.amount) - Math.abs(R[b].rec.amount - lp.rec.amount));
    const ri = options[0];
    usedL.add(li);
    usedR.add(ri);
    result.mismatches.push({ l: li, r: ri, diff: lp.rec.amount - R[ri].rec.amount });
  });

  // ---- Pass 3: ghép nhóm (một khoản bên này = tổng nhiều khoản bên kia)
  const unL = () => L.map((_, i) => i).filter((i) => !usedL.has(i) && L[i].rec.date);
  const unR = () => R.map((_, i) => i).filter((i) => !usedR.has(i) && R[i].rec.date);
  const budget = { nodes: 400_000 };

  const groupPass = (targets: number[], targetSide: Prepared[], pool: number[], poolSide: Prepared[], targetIsLeft: boolean) => {
    const order = [...targets].sort((a, b) => targetSide[b].rec.amount - targetSide[a].rec.amount).slice(0, 400);
    for (const t of order) {
      if ((targetIsLeft ? usedL : usedR).has(t)) continue;
      const tp = targetSide[t];
      const near = pool
        .filter((p) => !(targetIsLeft ? usedR : usedL).has(p))
        .filter((p) => poolSide[p].rec.amount < tp.rec.amount + tol)
        .filter((p) => Math.abs(dayDiff(poolSide[p].rec.date as string, tp.rec.date as string)) <= opts.windowDays)
        .sort(
          (a, b) =>
            Math.abs(dayDiff(poolSide[a].rec.date as string, tp.rec.date as string)) -
            Math.abs(dayDiff(poolSide[b].rec.date as string, tp.rec.date as string)),
        )
        .slice(0, 30);
      if (near.length < 2) continue;
      const subset = findSubset(tp.rec.amount, near.map((p) => ({ idx: p, amt: poolSide[p].rec.amount })), tol, 4, budget);
      if (!subset) continue;
      if (targetIsLeft) {
        usedL.add(t);
        for (const s of subset) usedR.add(s);
        result.groups.push({ left: [t], right: subset });
      } else {
        usedR.add(t);
        for (const s of subset) usedL.add(s);
        result.groups.push({ left: subset, right: [t] });
      }
    }
  };
  groupPass(unR(), R, unL(), L, false);
  groupPass(unL(), L, unR(), R, true);

  result.leftUnmatched = L.map((_, i) => i).filter((i) => !usedL.has(i));
  result.rightUnmatched = R.map((_, i) => i).filter((i) => !usedR.has(i));
  return result;
}

// ---------------------------------------------------------------- áp dụng cho từng cặp nguồn

interface PairSpec {
  left: SourceRole;
  right: SourceRole;
  windowDays: number;
  textRefMatch: boolean;
  reportRightUnmatched: boolean;
  leftMissingTitle: string;
  leftMissingNote: string;
  rightMissingTitle?: string;
  rightMissingNote?: string;
  scopeNote: string;
}

function specs(ctx: RuleContext): PairSpec[] {
  const has = (role: SourceRole) => ctx.positive.some((r) => r.role === role);
  const list: PairSpec[] = [];
  const w = ctx.settings.dateWindowDays;
  if (has("ledger") && has("bank")) {
    list.push({
      left: "ledger",
      right: "bank",
      windowDays: w,
      textRefMatch: false,
      reportRightUnmatched: true,
      leftMissingTitle: "Có trong sổ sách nhưng không thấy trên sao kê ngân hàng",
      leftMissingNote: "Không có giao dịch cùng số tiền trên sao kê",
      rightMissingTitle: "Có trên sao kê ngân hàng nhưng chưa ghi vào sổ sách",
      rightMissingNote: "Không có bút toán cùng số tiền trong sổ sách",
      scopeNote: "Kết quả chỉ có ý nghĩa nếu file sổ sách là sổ tiền gửi/tài khoản ngân hàng (ví dụ TK 112) và cùng kỳ với sao kê.",
    });
  }
  if (has("invoice") && has("ledger")) {
    list.push({
      left: "invoice",
      right: "ledger",
      windowDays: Math.max(w, 30),
      textRefMatch: true,
      reportRightUnmatched: false,
      leftMissingTitle: "Hóa đơn chưa thấy hạch toán trong sổ sách",
      leftMissingNote: "Không có bút toán cùng số tiền (hoặc nhắc tới số hóa đơn này) trong sổ sách",
      scopeNote: "Ghép theo số tiền, ngày (cửa sổ rộng hơn) và số hóa đơn xuất hiện trong diễn giải sổ sách.",
    });
  } else if (has("invoice") && has("bank")) {
    list.push({
      left: "invoice",
      right: "bank",
      windowDays: Math.max(w, 30),
      textRefMatch: true,
      reportRightUnmatched: false,
      leftMissingTitle: "Hóa đơn chưa thấy thanh toán qua ngân hàng",
      leftMissingNote: "Không có giao dịch cùng số tiền (hoặc nhắc tới số hóa đơn này) trên sao kê",
      scopeNote: "Hóa đơn có thể được thanh toán nhiều lần, bằng tiền mặt hoặc ngoài kỳ sao kê nên cần xem xét từng trường hợp.",
    });
  }
  return list;
}

export interface ReconcileOutput {
  drafts: FindingDraft[];
  summaries: ReconciliationSummary[];
}

export function reconciliationRules(ctx: RuleContext): ReconcileOutput {
  const out: ReconcileOutput = { drafts: [], summaries: [] };
  const bigThreshold = maxThreshold(ctx.settings);

  for (const spec of specs(ctx)) {
    const leftRecs = ctx.positive.filter((r) => r.role === spec.left);
    const rightRecs = ctx.positive.filter((r) => r.role === spec.right);
    const L = prepare(leftRecs);
    const R = prepare(rightRecs);
    const res = reconcile(L, R, {
      tolerance: ctx.settings.amountTolerance,
      windowDays: spec.windowDays,
      textRefMatch: spec.textRefMatch,
    });

    const leftLabel = ROLE_LABELS[spec.left];
    const rightLabel = ROLE_LABELS[spec.right];
    const leftTotal = sum(leftRecs.map((r) => r.amount));
    const rightTotal = sum(rightRecs.map((r) => r.amount));
    const matchedLeft = res.pairs.length + sum(res.groups.map((g) => g.left.length));
    const matchRate = leftRecs.length ? matchedLeft / leftRecs.length : 0;
    const leftUnmatchedRecs = res.leftUnmatched.map((i) => L[i].rec);
    const rightUnmatchedRecs = res.rightUnmatched.map((i) => R[i].rec);

    out.summaries.push({
      id: `${spec.left}-${spec.right}`,
      leftRole: spec.left,
      rightRole: spec.right,
      leftLabel,
      rightLabel,
      leftCount: leftRecs.length,
      rightCount: rightRecs.length,
      leftAmount: leftTotal,
      rightAmount: rightTotal,
      matched: res.pairs.length,
      matchedGroups: res.groups.length,
      amountMismatches: res.mismatches.length,
      leftUnmatched: leftUnmatchedRecs.length,
      rightUnmatched: rightUnmatchedRecs.length,
      leftUnmatchedAmount: sum(leftUnmatchedRecs.map((r) => r.amount)),
      rightUnmatchedAmount: sum(rightUnmatchedRecs.map((r) => r.amount)),
      rightUnmatchedReported: spec.reportRightUnmatched,
      matchRate,
    });

    const lowMatch = matchRate < 0.3 && leftRecs.length >= 10 && rightRecs.length >= 10;
    if (lowMatch) {
      out.drafts.push({
        rule: "recon_low_match_rate",
        severity: "low",
        title: `Tỷ lệ đối chiếu thấp: ${leftLabel} ↔ ${rightLabel}`,
        description: `Chỉ ${fmtPct(matchRate)} giao dịch của ${leftLabel} ghép được với ${rightLabel} (${matchedLeft.toLocaleString("vi-VN")}/${leftRecs.length.toLocaleString("vi-VN")}). ${spec.scopeNote} Các cảnh báo "không đối chiếu được" bên dưới được hạ mức để tránh báo động giả.`,
        recommendation: "Kiểm tra lại file đã chọn có đúng loại, đúng tài khoản, đúng kỳ; chỉnh \"Cửa sổ ngày\" hoặc \"Dung sai\" trong phần cài đặt nếu cần.",
        records: [],
        amount: 0,
      });
    }

    // ---- lệch số tiền cùng số chứng từ
    if (res.mismatches.length > 0) {
      const records: AuditRecord[] = [];
      const notes = new Map<string, string>();
      const sorted = [...res.mismatches].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
      for (const m of sorted) {
        const lr = L[m.l].rec;
        const rr = R[m.r].rec;
        records.push(lr, rr);
        notes.set(lr.id, `Cùng số "${lr.reference}" nhưng ${fmtMoney(lr.amount)} so với ${fmtMoney(rr.amount)} bên ${rightLabel} (lệch ${fmtMoney(m.diff)})`);
        notes.set(rr.id, `Cùng số "${rr.reference}" nhưng ${fmtMoney(rr.amount)} so với ${fmtMoney(lr.amount)} bên ${leftLabel} (lệch ${fmtMoney(-m.diff)})`);
      }
      out.drafts.push({
        rule: "recon_amount_mismatch",
        severity: "high",
        title: `Cùng chứng từ nhưng lệch số tiền: ${leftLabel} ↔ ${rightLabel}`,
        description: `${res.mismatches.length.toLocaleString("vi-VN")} chứng từ có cùng số tham chiếu ở hai nguồn nhưng số tiền khác nhau, tổng chênh lệch tuyệt đối ${fmtMoney(sum(res.mismatches.map((m) => Math.abs(m.diff))))}. Đây là dấu hiệu rõ nhất của việc sửa số hoặc ghi sai số tiền.`,
        recommendation: "Lấy chứng từ gốc (ủy nhiệm chi, hóa đơn, sao kê ngân hàng gốc) để biết số nào đúng; xem ai là người ghi và người duyệt.",
        records,
        notes,
        amount: sum(res.mismatches.map((m) => Math.abs(m.diff))),
      });
    }

    // ---- phần dư
    const emitUnmatched = (recs: AuditRecord[], sideTotal: number, title: string, note: string, otherLabel: string) => {
      if (recs.length === 0) return;
      const total = sum(recs.map((r) => r.amount));
      const biggest = Math.max(...recs.map((r) => r.amount));
      const share = sideTotal > 0 ? total / sideTotal : 0;
      let severity: Severity = "medium";
      if (share >= 0.1 || biggest >= bigThreshold) severity = "high";
      if (recs.length <= 2 && biggest < ctx.settings.minAmount) severity = "low";
      if (lowMatch) severity = "low";
      const sorted = sortByAmountDesc(recs);
      const notes = new Map(sorted.map((r) => [r.id, note] as const));
      out.drafts.push({
        rule: "recon_unmatched",
        severity,
        title,
        description: `${recs.length.toLocaleString("vi-VN")} giao dịch (tổng ${fmtMoney(total)}, ${fmtPct(share)} tổng giá trị) không ghép được với ${otherLabel} theo số tiền (dung sai ${fmtMoney(ctx.settings.amountTolerance)}), ngày (±${spec.windowDays} ngày) và chứng từ. Khoản lớn nhất ${fmtMoney(biggest)}. ${spec.scopeNote}`,
        recommendation: "Với từng khoản: tìm chứng từ gốc, hỏi người ghi nhận. Khoản chênh thời điểm giữa hai kỳ có thể là hợp lệ (cut-off); khoản không có đối ứng ở bất kỳ kỳ nào mới là điểm cần điều tra.",
        records: sorted,
        notes,
        amount: total,
        meta: { share: Number(share.toFixed(3)), count: recs.length },
      });
    };

    emitUnmatched(leftUnmatchedRecs, leftTotal, spec.leftMissingTitle, spec.leftMissingNote, rightLabel);
    if (spec.reportRightUnmatched && spec.rightMissingTitle && spec.rightMissingNote) {
      emitUnmatched(rightUnmatchedRecs, rightTotal, spec.rightMissingTitle, spec.rightMissingNote, leftLabel);
    }
  }
  return out;
}
