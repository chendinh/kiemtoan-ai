// Kiểm định quy luật Benford trên chữ số đầu của số tiền (MAD, chi-square, z từng chữ số, cặp 2 chữ số đầu).

import type { AuditRecord, BenfordResult, BenfordSkipped } from "@/lib/types";
import { fmtPct } from "@/lib/util/stats";
import { type FindingDraft, type RuleContext, sortByAmountDesc } from "../shared";

const MIN_N = 100;
const MIN_N_PAIRS = 300;
// Giá trị tới hạn chi-square (8 bậc tự do). Với mẫu nhỏ, MAD tự nhiên đã cao hơn ngưỡng của Nigrini nên phải có ý nghĩa thống kê.
const CHI_CRIT_5 = 15.51;
const CHI_CRIT_1 = 20.09;

const EXPECTED_1 = Array.from({ length: 9 }, (_, i) => Math.log10(1 + 1 / (i + 1)));

function leading(x: number): { d1: number; d2: number } | null {
  if (!(x > 0) || !Number.isFinite(x)) return null;
  const e = x.toExponential(10);
  return { d1: e.charCodeAt(0) - 48, d2: e.charCodeAt(2) - 48 };
}

function zScore(observed: number, expected: number, n: number): number {
  const diff = Math.abs(observed - expected);
  const cc = 1 / (2 * n);
  const adj = diff > cc ? diff - cc : diff;
  return adj / Math.sqrt((expected * (1 - expected)) / n);
}

function conformityOf(mad: number): BenfordResult["conformity"] {
  if (mad <= 0.006) return "close";
  if (mad <= 0.012) return "acceptable";
  if (mad <= 0.015) return "marginal";
  return "nonconforming";
}

export interface BenfordOutput {
  drafts: FindingDraft[];
  results: BenfordResult[];
  skipped: BenfordSkipped[];
}

export function benfordRule(ctx: RuleContext): BenfordOutput {
  const out: BenfordOutput = { drafts: [], results: [], skipped: [] };

  const byFile = new Map<string, AuditRecord[]>();
  for (const r of ctx.positive) {
    const g = byFile.get(r.fileId);
    if (g) g.push(r);
    else byFile.set(r.fileId, [r]);
  }

  for (const [fileId, recs] of byFile) {
    const fileName = recs[0].fileName;
    const digits: { rec: AuditRecord; d1: number; d2: number }[] = [];
    for (const rec of recs) {
      const l = leading(rec.amount);
      if (l && l.d1 >= 1 && l.d1 <= 9) digits.push({ rec, d1: l.d1, d2: l.d2 });
    }
    const n = digits.length;
    if (n < MIN_N) {
      out.skipped.push({ fileId, fileName, n });
      continue;
    }

    const counts = new Array<number>(9).fill(0);
    for (const d of digits) counts[d.d1 - 1]++;
    const observed = counts.map((c) => c / n);
    const mad = observed.reduce((s, p, i) => s + Math.abs(p - EXPECTED_1[i]), 0) / 9;
    const chiSquare = counts.reduce((s, c, i) => {
      const e = n * EXPECTED_1[i];
      return s + (c - e) ** 2 / e;
    }, 0);
    const digitFlags = observed
      .map((p, i) => ({ digit: i + 1, observed: p, expected: EXPECTED_1[i], z: zScore(p, EXPECTED_1[i], n) }))
      .filter((f) => f.z > 1.96);

    const pairSpikes: BenfordResult["pairSpikes"] = [];
    if (n >= MIN_N_PAIRS) {
      const pc = new Array<number>(90).fill(0);
      for (const d of digits) pc[d.d1 * 10 + d.d2 - 10]++;
      for (let k = 0; k < 90; k++) {
        const dd = k + 10;
        const e = Math.log10(1 + 1 / dd);
        const p = pc[k] / n;
        const z = zScore(p, e, n);
        if (p > e && z > 3 && pc[k] >= 5) pairSpikes.push({ pair: dd, observed: p, expected: e, z, count: pc[k] });
      }
      pairSpikes.sort((a, b) => b.z - a.z);
      pairSpikes.splice(5);
    }

    let conformity = conformityOf(mad);
    if (chiSquare <= CHI_CRIT_5 && (conformity === "marginal" || conformity === "nonconforming")) conformity = "acceptable";

    const result: BenfordResult = {
      fileId,
      fileName,
      n,
      observed,
      expected: EXPECTED_1,
      counts,
      mad,
      chiSquare,
      conformity,
      digitFlags: digitFlags.map((f) => ({ ...f })),
      pairSpikes,
    };
    out.results.push(result);

    if (result.conformity === "close" || result.conformity === "acceptable") continue;
    if (chiSquare <= CHI_CRIT_1) continue;

    // Chọn tối đa 2 chữ số bị "thừa" nhiều nhất để lấy bằng chứng.
    const over = observed
      .map((p, i) => ({ digit: i + 1, diff: p - EXPECTED_1[i], z: zScore(p, EXPECTED_1[i], n) }))
      .filter((o) => o.diff > 0)
      .sort((a, b) => b.z - a.z)
      .slice(0, 2);
    const overDigits = new Set(over.map((o) => o.digit));
    const evidence = sortByAmountDesc(digits.filter((d) => overDigits.has(d.d1)).map((d) => d.rec));
    const notes = new Map<string, string>();
    for (const d of digits) if (overDigits.has(d.d1)) notes.set(d.rec.id, `Chữ số đầu ${d.d1}`);

    const label = result.conformity === "marginal" ? "ở mức ranh giới" : "không phù hợp";
    const overText = over
      .map((o) => `chữ số ${o.digit}: ${fmtPct(observed[o.digit - 1])} (kỳ vọng ${fmtPct(EXPECTED_1[o.digit - 1])})`)
      .join("; ");
    const pairText =
      pairSpikes.length > 0
        ? ` Cặp hai chữ số đầu nổi bật: ${pairSpikes
            .slice(0, 3)
            .map((s) => `${s.pair} (${s.count} dòng, ${fmtPct(s.observed, 2)} so với ${fmtPct(s.expected, 2)})`)
            .join("; ")}.`
        : "";

    out.drafts.push({
      rule: "benford",
      severity: result.conformity === "nonconforming" && chiSquare > 40 ? "medium" : "low",
      title: "Phân phối chữ số đầu lệch quy luật Benford",
      description: `File ${fileName} (${n.toLocaleString("vi-VN")} giao dịch): độ lệch trung bình MAD = ${mad.toFixed(4)} (${label}), chi-square = ${chiSquare.toFixed(1)}. Chữ số bị thừa nhiều nhất: ${overText}.${pairText} Lệch Benford chỉ là gợi ý chọn mẫu: cần xem các giao dịch bắt đầu bằng các chữ số này.`,
      recommendation: "Chọn mẫu các giao dịch có chữ số đầu bị thừa, đối chiếu chứng từ gốc; kiểm tra các số được ước lượng, số cố định theo hợp đồng hoặc số bị nhập tay.",
      records: evidence,
      notes,
      meta: { fileId, mad: Number(mad.toFixed(5)), n },
    });
  }

  return out;
}
