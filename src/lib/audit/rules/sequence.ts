// Đứt quãng dãy số chứng từ/hóa đơn.

import type { AuditRecord, Severity } from "@/lib/types";
import { splitSequence } from "@/lib/util/text";
import { type FindingDraft, type RuleContext, roleLabelShort } from "../shared";

interface Item {
  rec: AuditRecord;
  num: number;
}

function formatRanges(ranges: [number, number][], width: number, prefix: string, limit = 8): string {
  const fmt = (n: number) => `${prefix}${String(n).padStart(width, "0")}`;
  const parts = ranges.slice(0, limit).map(([a, b]) => (a === b ? fmt(a) : `${fmt(a)}–${fmt(b)}`));
  const more = ranges.length > limit ? ` … (+${ranges.length - limit} đoạn nữa)` : "";
  return parts.join(", ") + more;
}

export function sequenceGapRule(ctx: RuleContext): FindingDraft[] {
  const out: FindingDraft[] = [];

  const groups = new Map<string, { items: Item[]; width: number; prefix: string; series: string }>();
  for (const r of ctx.records) {
    if (r.role === "bank") continue; // mã giao dịch ngân hàng không phải dãy liên tục
    const seq = splitSequence(r.reference);
    if (!seq || seq.width < 3) continue;
    const key = `${r.role}|${r.series ?? ""}|${seq.prefix}|${seq.width}`;
    let g = groups.get(key);
    if (!g) {
      g = { items: [], width: seq.width, prefix: seq.prefix, series: r.series ?? "" };
      groups.set(key, g);
    }
    g.items.push({ rec: r, num: seq.num });
  }

  for (const g of groups.values()) {
    const distinct = [...new Set(g.items.map((i) => i.num))].sort((a, b) => a - b);
    if (distinct.length < 10) continue;
    const span = distinct[distinct.length - 1] - distinct[0] + 1;
    const missingTotal = span - distinct.length;
    if (missingTotal <= 0 || missingTotal / span > 0.5) continue;

    const ranges: [number, number][] = [];
    for (let i = 1; i < distinct.length; i++) {
      if (distinct[i] - distinct[i - 1] > 1) ranges.push([distinct[i - 1] + 1, distinct[i] - 1]);
    }
    if (ranges.length === 0) continue;

    const byNum = new Map<number, AuditRecord>();
    for (const i of g.items) if (!byNum.has(i.num)) byNum.set(i.num, i.rec);
    const records: AuditRecord[] = [];
    const notes = new Map<string, string>();
    for (const [a, b] of ranges.slice(0, 20)) {
      const before = byNum.get(a - 1);
      const after = byNum.get(b + 1);
      const label = a === b ? `${a}` : `${a}–${b}`;
      if (before) {
        records.push(before);
        notes.set(before.id, `Liền trước đoạn thiếu số ${label}`);
      }
      if (after) {
        records.push(after);
        notes.set(after.id, `Liền sau đoạn thiếu số ${label}`);
      }
    }

    const role = g.items[0].rec.role;
    const seriesText = g.series ? ` ký hiệu ${g.series}` : "";
    const severity: Severity = role === "invoice" ? "medium" : "low";
    out.push({
      rule: "sequence_gap",
      severity,
      title: `Dãy số ${role === "invoice" ? "hóa đơn" : "chứng từ"} bị đứt quãng (${roleLabelShort(role)})`,
      description: `Dãy số${seriesText}${g.prefix ? ` (tiền tố "${g.prefix}")` : ""} có ${distinct.length.toLocaleString("vi-VN")} số trong khoảng ${span.toLocaleString("vi-VN")}; thiếu ${missingTotal.toLocaleString("vi-VN")} số: ${formatRanges(ranges, g.width, g.prefix)}.`,
      recommendation:
        role === "invoice"
          ? "Hỏi lý do từng số thiếu (hóa đơn hủy, xóa bỏ, chưa lập). Tra cứu trên hệ thống hóa đơn điện tử; số bị thiếu có thể là doanh thu chưa kê khai."
          : "Hỏi lý do các số chứng từ bị thiếu; kiểm tra sổ đăng ký chứng từ hủy.",
      records,
      notes,
      amount: 0,
      meta: { prefix: g.prefix, missing: missingTotal, ranges: ranges.length },
    });
  }
  return out;
}
