// Luật về số tiền: số tròn, dồn sát ngưỡng, tách nhỏ giao dịch, giá trị lớn bất thường.

import type { AuditRecord, Severity } from "@/lib/types";
import { fmtMoney, fmtPct, mad, median, sum } from "@/lib/util/stats";
import { partyKey } from "@/lib/util/text";
import { dayDiff } from "@/lib/util/values";
import {
  type FindingDraft,
  type RuleContext,
  type SigRegistry,
  recordsOfRole,
  roleLabelShort,
  sideOf,
  sortByAmountDesc,
} from "../shared";

const isRound = (amount: number, unit: number): boolean => {
  const q = amount / unit;
  return Math.abs(q - Math.round(q)) < 1e-9;
};

// ---------------------------------------------------------------- số tiền tròn

export function roundAmountRule(ctx: RuleContext): FindingDraft[] {
  const out: FindingDraft[] = [];
  const unit = ctx.settings.roundUnit;
  if (!(unit > 0)) return out;

  const byFile = new Map<string, AuditRecord[]>();
  for (const r of ctx.positive) {
    if (r.amount < ctx.settings.minAmount) continue;
    const g = byFile.get(r.fileId);
    if (g) g.push(r);
    else byFile.set(r.fileId, [r]);
  }

  for (const recs of byFile.values()) {
    if (recs.length < 20) continue;
    const round = recs.filter((r) => isRound(r.amount, unit));
    const share = round.length / recs.length;
    if (share < 0.3) continue;
    const sorted = sortByAmountDesc(round);
    out.push({
      rule: "round_amount",
      severity: share >= 0.6 ? "medium" : "low",
      title: "Tỷ lệ số tiền tròn cao",
      description: `File ${recs[0].fileName}: ${round.length.toLocaleString("vi-VN")}/${recs.length.toLocaleString("vi-VN")} giao dịch (${fmtPct(share)}) từ ${fmtMoney(ctx.settings.minAmount)} trở lên là bội số của ${fmtMoney(unit)}. Số liệu thực tế phát sinh hiếm khi tròn như vậy; thường là số ước lượng hoặc số do người nhập tự đặt.`,
      recommendation: "Chọn mẫu các giao dịch tròn lớn nhất, kiểm tra hợp đồng/biên bản thỏa thuận. Nếu là khoản cố định theo hợp đồng (lương, thuê, vay) thì có thể bỏ qua.",
      records: sorted,
      amount: sum(sorted.map((r) => r.amount)),
      meta: { share: Number(share.toFixed(3)), count: round.length },
    });
  }
  return out;
}

// ---------------------------------------------------------------- dồn sát dưới ngưỡng

export function thresholdBunchingRule(ctx: RuleContext, registry: SigRegistry): FindingDraft[] {
  const out: FindingDraft[] = [];
  const pct = Math.max(0.5, ctx.settings.thresholdBandPct) / 100;
  const thresholds = [...ctx.settings.thresholds].filter((t) => t > 0).sort((a, b) => a - b);

  for (const T of thresholds) {
    const low = T * (1 - pct);
    const high = T * (1 + pct);
    for (const role of ctx.roles) {
      const recs = recordsOfRole(ctx, role);
      const below = recs.filter((r) => r.amount >= low && r.amount < T);
      const above = recs.filter((r) => r.amount >= T && r.amount <= high);
      const ratio = below.length / (above.length + 1);
      if (below.length < 3 || ratio < 2) continue;
      if (registry.overlap(below) >= 0.6) continue;
      registry.claim(below);

      const notes = new Map<string, string>();
      for (const r of below) notes.set(r.id, `Thấp hơn ngưỡng ${fmtMoney(T - r.amount)}`);
      const severity: Severity = below.length >= 5 && ratio >= 4 ? "high" : "medium";
      out.push({
        rule: "threshold_bunching",
        severity,
        title: `Dồn số tiền sát dưới ngưỡng ${fmtMoney(T)}`,
        description: `Trong ${roleLabelShort(role)}, có ${below.length} giao dịch nằm trong dải ${fmtMoney(low)} - ${fmtMoney(T)} (ngay dưới ngưỡng) nhưng chỉ ${above.length} giao dịch trong dải ${fmtMoney(T)} - ${fmtMoney(high)} (ngay trên ngưỡng). Phân phối tự nhiên không có chỗ gãy như vậy; thường là số tiền bị giữ dưới hạn mức phê duyệt.`,
        recommendation: "Xem ai lập và ai duyệt các khoản này, kiểm tra có tách hóa đơn/tách đợt thanh toán hay không, đối chiếu với hạn mức phê duyệt nội bộ.",
        records: sortByAmountDesc(below),
        notes,
        meta: { threshold: T, below: below.length, above: above.length },
      });
      break; // mỗi ngưỡng chỉ báo một lần ở nguồn ưu tiên cao nhất
    }
  }
  return out;
}

// ---------------------------------------------------------------- tách nhỏ giao dịch

interface Cluster {
  recs: AuditRecord[];
  threshold: number;
  total: number;
  sameDayEqual: boolean;
}

export function splitRule(ctx: RuleContext, registry: SigRegistry): FindingDraft[] {
  const out: FindingDraft[] = [];
  const thresholds = [...ctx.settings.thresholds].filter((t) => t > 0).sort((a, b) => a - b);
  if (thresholds.length === 0) return out;
  const windowDays = ctx.settings.splitWindowDays;

  for (const role of ctx.roles) {
    const recs = recordsOfRole(ctx, role).filter((r) => r.date && partyKey(r.counterparty));
    const groups = new Map<string, AuditRecord[]>();
    for (const r of recs) {
      const k = `${partyKey(r.counterparty)}|${sideOf(r)}`;
      const g = groups.get(k);
      if (g) g.push(r);
      else groups.set(k, [r]);
    }

    const clusters: Cluster[] = [];
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      g.sort((a, b) => (a.date as string).localeCompare(b.date as string));
      const used = new Set<string>();
      for (const T of thresholds) {
        let i = 0;
        while (i < g.length) {
          const start = g[i];
          if (used.has(start.id)) {
            i++;
            continue;
          }
          const windowRecs: AuditRecord[] = [];
          for (let k = i; k < g.length && dayDiff(g[k].date as string, start.date as string) <= windowDays; k++) {
            windowRecs.push(g[k]);
          }
          // Dấu hiệu né ngưỡng: các khoản đều ngay dưới ngưỡng (từ 80% ngưỡng đến dưới ngưỡng).
          // Các khoản bằng nhau nhưng thấp hơn đã được luật "nghi thanh toán trùng" bao phủ.
          const elig = windowRecs.filter((r) => !used.has(r.id) && r.amount < T && r.amount >= 0.8 * T);
          const total = sum(elig.map((r) => r.amount));
          if (elig.length >= 2 && total >= T) {
            for (const r of elig) used.add(r.id);
            const sameDay = elig.every((r) => r.date === elig[0].date);
            const equal = elig.every((r) => Math.abs(r.amount - elig[0].amount) < 0.5);
            clusters.push({ recs: elig, threshold: T, total, sameDayEqual: sameDay && equal });
            i = g.indexOf(elig[elig.length - 1]) + 1;
          } else {
            i++;
          }
        }
      }
    }
    if (clusters.length === 0) continue;

    const all = clusters.flatMap((c) => c.recs);
    if (registry.overlap(all) >= 0.6) continue;
    registry.claim(all);

    clusters.sort((a, b) => b.total - a.total);
    const records: AuditRecord[] = [];
    const notes = new Map<string, string>();
    clusters.forEach((c, ci) => {
      for (const r of c.recs) {
        records.push(r);
        notes.set(r.id, `Cụm ${ci + 1} · ${c.recs.length} khoản, tổng ${fmtMoney(c.total)} vượt ngưỡng ${fmtMoney(c.threshold)}`);
      }
    });
    const severity: Severity = clusters.some((c) => c.sameDayEqual) ? "high" : "medium";
    out.push({
      rule: "split_transaction",
      severity,
      title: `Nghi tách nhỏ giao dịch (${roleLabelShort(role)})`,
      description: `${clusters.length.toLocaleString("vi-VN")} cụm giao dịch cùng đối tác trong vòng ${windowDays} ngày, từng khoản dưới ngưỡng phê duyệt nhưng tổng vượt ngưỡng (tổng ${fmtMoney(sum(clusters.map((c) => c.total)))}). Đây là cách thường dùng để né hạn mức duyệt hoặc quy định thanh toán không dùng tiền mặt.`,
      recommendation: "Kiểm tra từng cụm: một hợp đồng/đơn hàng hay nhiều? Ai duyệt từng khoản? Có hóa đơn gộp tương ứng không?",
      records,
      notes,
      amount: sum(clusters.map((c) => c.total)),
      meta: { clusters: clusters.length },
    });
  }
  return out;
}

// ---------------------------------------------------------------- giá trị lớn bất thường

interface OutlierHit {
  rec: AuditRecord;
  z: number;
  note: string;
}

const MIN_PARTY_SAMPLES = 10;
const MIN_GLOBAL_SAMPLES = 30;

export function outlierRule(ctx: RuleContext, registry: SigRegistry): FindingDraft[] {
  const out: FindingDraft[] = [];

  for (const role of ctx.roles) {
    const recs = recordsOfRole(ctx, role).filter((r) => r.amount >= 1);

    const partyHits: OutlierHit[] = [];
    const groups = new Map<string, AuditRecord[]>();
    for (const r of recs) {
      const key = partyKey(r.counterparty);
      if (!key) continue;
      const k = `${key}|${sideOf(r)}`;
      const g = groups.get(k);
      if (g) g.push(r);
      else groups.set(k, [r]);
    }
    for (const g of groups.values()) {
      if (g.length < MIN_PARTY_SAMPLES) continue;
      const logs = g.map((r) => Math.log(r.amount));
      const med = median(logs);
      const scale = mad(logs, med) || 0.1;
      const medAmount = Math.exp(med);
      for (const r of g) {
        const z = (0.6745 * (Math.log(r.amount) - med)) / scale;
        if (z > 4 && r.amount >= ctx.settings.minAmount && r.amount >= 3 * medAmount) {
          partyHits.push({
            rec: r,
            z,
            note: `Gấp ${(r.amount / medAmount).toFixed(1).replace(".", ",")} lần mức thường gặp với đối tác này (${fmtMoney(medAmount)}), z=${z.toFixed(1)}`,
          });
        }
      }
    }

    const partyIds = new Set(partyHits.map((h) => h.rec.id));
    const globalHits: OutlierHit[] = [];
    if (recs.length >= MIN_GLOBAL_SAMPLES) {
      const logs = recs.map((r) => Math.log(r.amount));
      const med = median(logs);
      const scale = mad(logs, med) || 0.1;
      for (const r of recs) {
        if (partyIds.has(r.id)) continue;
        const z = (0.6745 * (Math.log(r.amount) - med)) / scale;
        if (z > 4 && r.amount >= ctx.settings.minAmount) {
          globalHits.push({
            rec: r,
            z,
            note: `Lớn hơn nhiều so với mặt bằng chung của ${roleLabelShort(role)} (trung vị ${fmtMoney(Math.exp(med))}), z=${z.toFixed(1)}`,
          });
        }
      }
    }

    const emit = (hits: OutlierHit[], severity: Severity, title: string, description: string) => {
      if (hits.length === 0) return;
      const sorted = [...hits].sort((a, b) => b.z - a.z);
      const records = sorted.map((h) => h.rec);
      if (registry.overlap(records) >= 0.6) return;
      registry.claim(records);
      const notes = new Map(sorted.map((h) => [h.rec.id, h.note] as const));
      out.push({
        rule: "outlier",
        severity,
        title,
        description,
        recommendation: "Xem hợp đồng, phê duyệt và hóa đơn của các khoản này; hỏi lý do vì sao lớn hơn thông lệ.",
        records,
        notes,
      });
    };

    emit(
      partyHits,
      "medium",
      `Khoản lớn bất thường so với lịch sử đối tác (${roleLabelShort(role)})`,
      `${partyHits.length} giao dịch lớn hơn hẳn mức thường gặp của chính đối tác đó (đã tính trên ít nhất ${MIN_PARTY_SAMPLES} giao dịch mỗi đối tác, thang logarit).`,
    );
    emit(
      globalHits,
      "low",
      `Khoản cực lớn so với mặt bằng chung (${roleLabelShort(role)})`,
      `${globalHits.length} giao dịch nằm rất xa mặt bằng chung của nguồn dữ liệu (độ lệch robust z > 4 trên thang logarit).`,
    );
  }
  return out;
}
