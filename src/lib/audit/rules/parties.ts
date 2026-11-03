// Đối tác: tên gần giống nhau, mã số thuế và tên mâu thuẫn.

import type { AuditRecord, Severity } from "@/lib/types";
import { fmtMoney, sum } from "@/lib/util/stats";
import { partyKey, similarity } from "@/lib/util/text";
import { type FindingDraft, type RuleContext, maxThreshold, sortByAmountDesc } from "../shared";

interface PartyInfo {
  key: string;
  names: Map<string, number>;
  recs: AuditRecord[];
  taxCodes: Set<string>;
  total: number;
}

function mainName(p: PartyInfo): string {
  let best = "";
  let n = -1;
  for (const [name, c] of p.names) {
    if (c > n) {
      best = name;
      n = c;
    }
  }
  return best;
}

/** MST Việt Nam: 10 số (hoặc 13 số có hậu tố chi nhánh). Lấy 10 số đầu. */
function normTaxCode(raw: string | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length === 10 || digits.length === 13) return digits.slice(0, 10);
  return null;
}

const onlyDigitsDiffer = (a: string, b: string) => a.replace(/\d+/g, "#") === b.replace(/\d+/g, "#");

export function partyRules(ctx: RuleContext): FindingDraft[] {
  const out: FindingDraft[] = [];

  const parties = new Map<string, PartyInfo>();
  for (const r of ctx.positive) {
    const key = partyKey(r.counterparty);
    if (!key || !r.counterparty) continue;
    let p = parties.get(key);
    if (!p) {
      p = { key, names: new Map(), recs: [], taxCodes: new Set(), total: 0 };
      parties.set(key, p);
    }
    p.names.set(r.counterparty, (p.names.get(r.counterparty) ?? 0) + 1);
    p.recs.push(r);
    p.total += r.amount;
    const mst = normTaxCode(r.taxCode);
    if (mst) p.taxCodes.add(mst);
  }
  if (parties.size === 0) return out;

  // ---- MST và tên mâu thuẫn
  const byTax = new Map<string, Set<string>>();
  for (const p of parties.values()) {
    for (const t of p.taxCodes) {
      const s = byTax.get(t) ?? new Set<string>();
      s.add(p.key);
      byTax.set(t, s);
    }
  }
  const conflictRecords: AuditRecord[] = [];
  const conflictNotes = new Map<string, string>();
  const conflictLines: string[] = [];
  for (const [mst, keys] of byTax) {
    const list = [...keys];
    if (list.length < 2) continue;
    // Nếu các tên gần giống nhau (cùng một đơn vị viết khác) thì để luật "tên gần giống" xử lý.
    let allSimilar = true;
    for (let i = 0; i < list.length && allSimilar; i++) {
      for (let j = i + 1; j < list.length; j++) if (similarity(list[i], list[j]) < 0.8) allSimilar = false;
    }
    if (allSimilar) continue;
    conflictLines.push(`MST ${mst} đi với ${list.length} tên: ${list.map((k) => `"${mainName(parties.get(k) as PartyInfo)}"`).join(", ")}`);
    for (const k of list) {
      const p = parties.get(k) as PartyInfo;
      for (const r of p.recs.slice(0, 5)) {
        conflictRecords.push(r);
        conflictNotes.set(r.id, `MST ${mst} · tên "${mainName(p)}"`);
      }
    }
  }
  for (const p of parties.values()) {
    if (p.taxCodes.size < 2) continue;
    const name = mainName(p);
    conflictLines.push(`Tên "${name}" đi với ${p.taxCodes.size} mã số thuế: ${[...p.taxCodes].join(", ")}`);
    for (const r of p.recs) {
      const mst = normTaxCode(r.taxCode);
      if (!mst) continue;
      conflictRecords.push(r);
      conflictNotes.set(r.id, `Tên "${name}" · MST ${mst}`);
    }
  }
  if (conflictLines.length > 0) {
    out.push({
      rule: "tax_code_conflict",
      severity: "medium",
      title: "Mã số thuế và tên đối tác mâu thuẫn",
      description: `${conflictLines.length} trường hợp: ${conflictLines.slice(0, 6).join("; ")}${conflictLines.length > 6 ? "…" : ""}. Một mã số thuế chỉ thuộc về một đơn vị; mâu thuẫn thường xuất hiện ở hóa đơn của đơn vị không có thật hoặc dữ liệu bị nhập sai.`,
      recommendation: "Tra cứu mã số thuế trên cổng thông tin của cơ quan thuế, kiểm tra tình trạng hoạt động và tên đăng ký.",
      records: sortByAmountDesc(conflictRecords),
      notes: conflictNotes,
    });
  }

  // ---- Tên gần giống nhau
  const keys = [...parties.values()].filter((p) => p.key.length >= 5).sort((a, b) => b.recs.length - a.recs.length).slice(0, 800);
  const pairs: { a: PartyInfo; b: PartyInfo; sim: number }[] = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i];
      const b = keys[j];
      if (a.key[0] !== b.key[0]) continue;
      if (Math.abs(a.key.length - b.key.length) > 3) continue;
      if (onlyDigitsDiffer(a.key, b.key)) continue;
      const sim = similarity(a.key, b.key);
      if (sim >= 0.85 && sim < 1) pairs.push({ a, b, sim });
    }
  }
  if (pairs.length > 0) {
    pairs.sort((x, y) => y.a.total + y.b.total - (x.a.total + x.b.total));
    const records: AuditRecord[] = [];
    const notes = new Map<string, string>();
    const shown = pairs.slice(0, 40);
    for (const p of shown) {
      const label = `"${mainName(p.a)}" ≈ "${mainName(p.b)}" (${Math.round(p.sim * 100)}%)`;
      for (const party of [p.a, p.b]) {
        for (const r of sortByAmountDesc(party.recs).slice(0, 2)) {
          if (notes.has(r.id)) continue;
          records.push(r);
          notes.set(r.id, label);
        }
      }
    }
    const combined = sum(shown.map((p) => p.a.total + p.b.total));
    const severity: Severity = combined >= maxThreshold(ctx.settings) ? "medium" : "low";
    out.push({
      rule: "similar_party",
      severity,
      title: "Tên đối tác gần giống nhau",
      description: `${pairs.length.toLocaleString("vi-VN")} cặp tên đối tác chỉ khác nhau vài ký tự (ví dụ ${pairs
        .slice(0, 2)
        .map((p) => `"${mainName(p.a)}" và "${mainName(p.b)}"`)
        .join("; ")}). Tổng giá trị liên quan ${fmtMoney(combined)}. Có thể là lỗi gõ tên, nhưng cũng là cách tạo đối tác ma hoặc chia nhỏ giao dịch theo nhiều tên.`,
      recommendation: "Hợp nhất danh mục đối tác; xem từng cặp có cùng mã số thuế/tài khoản ngân hàng/địa chỉ không; kiểm tra người tạo đối tác mới.",
      records,
      notes,
      amount: combined,
    });
  }

  return out;
}
