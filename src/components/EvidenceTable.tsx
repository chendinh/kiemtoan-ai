"use client";

import type { EvidenceRow } from "@/lib/types";
import { fmtDate, fmtMoney } from "@/lib/util/stats";

interface Props {
  rows: EvidenceRow[];
  caption: string;
  /** Ẩn cột "Nguồn" khi bảng chỉ có một file. */
  compact?: boolean;
  highlightIds?: Set<string>;
}

const th = "whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-700";
const td = "px-3 py-2 align-top text-sm text-slate-900";
const num = "whitespace-nowrap px-3 py-2 text-right align-top text-sm tabular-nums text-slate-900";

export default function EvidenceTable({ rows, caption, compact, highlightIds }: Props) {
  if (rows.length === 0) return null;
  const hasDebit = rows.some((r) => r.debit !== undefined && r.debit !== 0);
  const hasCredit = rows.some((r) => r.credit !== undefined && r.credit !== 0);
  const hasBalance = rows.some((r) => r.balance !== undefined);
  const hasParty = rows.some((r) => r.counterparty);
  const hasRef = rows.some((r) => r.reference);
  const hasNote = rows.some((r) => r.note);
  const hasDesc = rows.some((r) => r.description);

  return (
    <div role="region" aria-label={caption} tabIndex={0} className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-slate-50">
          <tr>
            <th scope="col" className={th}>
              Mã dòng
            </th>
            {!compact ? (
              <th scope="col" className={th}>
                Nguồn
              </th>
            ) : null}
            <th scope="col" className={th}>
              Ngày
            </th>
            {hasRef ? (
              <th scope="col" className={th}>
                Số chứng từ
              </th>
            ) : null}
            {hasDesc ? (
              <th scope="col" className={th}>
                Diễn giải
              </th>
            ) : null}
            {hasParty ? (
              <th scope="col" className={th}>
                Đối tượng
              </th>
            ) : null}
            {hasDebit ? (
              <th scope="col" className={`${th} text-right`}>
                Nợ / Ghi nợ
              </th>
            ) : null}
            {hasCredit ? (
              <th scope="col" className={`${th} text-right`}>
                Có / Ghi có
              </th>
            ) : null}
            <th scope="col" className={`${th} text-right`}>
              Số tiền
            </th>
            {hasBalance ? (
              <th scope="col" className={`${th} text-right`}>
                Số dư
              </th>
            ) : null}
            {hasNote ? (
              <th scope="col" className={th}>
                Ghi chú
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((r) => (
            <tr key={r.id} className={highlightIds?.has(r.id) ? "bg-amber-50" : undefined}>
              <td className={`${td} whitespace-nowrap font-mono text-xs`}>{r.id}</td>
              {!compact ? (
                <td className={`${td} whitespace-nowrap text-xs text-slate-700`}>
                  {r.fileId}
                  {r.sheet ? ` · ${r.sheet}` : ""} · dòng {r.row}
                </td>
              ) : null}
              <td className={`${td} whitespace-nowrap`}>{fmtDate(r.date)}</td>
              {hasRef ? <td className={`${td} whitespace-nowrap`}>{r.reference ?? ""}</td> : null}
              {hasDesc ? <td className={`${td} min-w-56 max-w-md`}>{r.description ?? ""}</td> : null}
              {hasParty ? <td className={`${td} min-w-40`}>{r.counterparty ?? ""}</td> : null}
              {hasDebit ? <td className={num}>{r.debit ? fmtMoney(r.debit) : ""}</td> : null}
              {hasCredit ? <td className={num}>{r.credit ? fmtMoney(r.credit) : ""}</td> : null}
              <td className={`${num} font-medium`}>{fmtMoney(r.amount)}</td>
              {hasBalance ? <td className={num}>{r.balance !== undefined ? fmtMoney(r.balance) : ""}</td> : null}
              {hasNote ? <td className={`${td} min-w-56 max-w-sm text-xs text-slate-800`}>{r.note ?? ""}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
