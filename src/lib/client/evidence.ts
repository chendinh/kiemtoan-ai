// Tra cứu dòng dữ liệu theo mã để hiển thị đầy đủ bằng chứng của từng phát hiện.

import type { AnalysisResult, AuditRecord, EvidenceRow, Finding } from "@/lib/types";

export function buildRecordLookup(result: AnalysisResult): Map<string, AuditRecord> {
  const map = new Map<string, AuditRecord>();
  for (const r of result.records) map.set(r.id, r);
  for (const r of result.digest.largest) map.set(r.id, r);
  for (const r of result.digest.sample) map.set(r.id, r);
  for (const f of result.findings) for (const e of f.evidence) if (!e.id.startsWith("TOT-")) map.set(e.id, e);
  return map;
}

/** Các dòng bằng chứng của phát hiện: ưu tiên bản có ghi chú, bổ sung các dòng còn lại nếu tra được. */
export function resolveRows(f: Finding, lookup: Map<string, AuditRecord>): EvidenceRow[] {
  if (f.recordIds.length <= f.evidence.length) return f.evidence;
  const own = new Map(f.evidence.map((e) => [e.id, e] as const));
  const rows: EvidenceRow[] = [];
  for (const id of f.recordIds) {
    const row = own.get(id) ?? lookup.get(id);
    if (row) rows.push(row);
  }
  return rows.length >= f.evidence.length ? rows : f.evidence;
}
