"use client";

import { useMemo } from "react";
import { CHECK_RULES, MONTHS, STATUS_LABELS, groupChecks } from "@/lib/shop/checks";
import type { CheckStatus, ShopCheck } from "@/lib/shop/types";
import type { Finding, RuleId } from "@/lib/types";
import { fmtMoney } from "@/lib/util/stats";

interface Props {
  checks: ShopCheck[];
  findings: Finding[];
  year: number;
  onOpenRules: (rules: RuleId[], label: string) => void;
}

const STATUS_CHIP: Record<CheckStatus, string> = {
  issue: "bg-red-100 text-red-900 ring-red-300",
  ok: "bg-emerald-100 text-emerald-900 ring-emerald-300",
  na: "bg-slate-100 text-slate-800 ring-slate-300",
};

const STATUS_MARK: Record<CheckStatus, string> = { issue: "▲", ok: "✓", na: "–" };

function MonthCell({ check, month }: { check: ShopCheck; month: number }) {
  const m = check.months[month];
  if (!m) {
    return (
      <td className="px-1 py-1.5 text-center text-slate-500">
        <span aria-hidden="true">·</span>
        <span className="sr-only">Tháng {month}: không có dữ liệu để kiểm</span>
      </td>
    );
  }
  if (m.status === "issue") {
    const money = m.amount > 0 ? `, ${fmtMoney(m.amount)} đồng` : "";
    return (
      <td className="bg-red-50 px-1 py-1.5 text-center font-semibold tabular-nums text-red-900" title={`Tháng ${month}: ${m.issues} mục lệch${money}`}>
        <span aria-hidden="true">▲ {m.issues.toLocaleString("vi-VN")}</span>
        <span className="sr-only">
          Tháng {month}: {m.issues} mục lệch{money}
        </span>
      </td>
    );
  }
  return (
    <td className="px-1 py-1.5 text-center text-emerald-800" title={`Tháng ${month}: đạt`}>
      <span aria-hidden="true">✓</span>
      <span className="sr-only">Tháng {month}: đạt</span>
    </td>
  );
}

export default function ShopMatrix({ checks, findings, year, onOpenRules }: Props) {
  const groups = useMemo(() => groupChecks(checks), [checks]);
  const perRule = useMemo(() => {
    const m = new Map<RuleId, number>();
    for (const f of findings) m.set(f.rule, (m.get(f.rule) ?? 0) + 1);
    return m;
  }, [findings]);
  const related = (rules: RuleId[]) => rules.reduce((s, r) => s + (perRule.get(r) ?? 0), 0);

  return (
    <div>
      <p className="mb-2 text-xs text-slate-700">
        <span className="font-semibold text-red-900">▲ n</span> có n mục lệch · <span className="font-semibold text-emerald-800">✓</span> đạt ·{" "}
        <span className="font-semibold">·</span> tháng không có dữ liệu để kiểm (không phải đạt).
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[60rem] border-collapse text-sm">
          <caption className="sr-only">
            Kết quả từng phép kiểm tiền theo tháng của năm {year}. Mỗi ô tháng cho biết có lệch (kèm số mục), đạt, hoặc không có dữ liệu để kiểm.
          </caption>
          <thead className="bg-slate-50 text-xs text-slate-700">
            <tr>
              <th scope="col" className="sticky left-0 z-10 min-w-64 bg-slate-50 px-3 py-2 text-left font-semibold">
                Phép kiểm
              </th>
              {MONTHS.map((m) => (
                <th key={m} scope="col" className="w-11 px-1 py-2 text-center font-semibold">
                  T{m}
                </th>
              ))}
              <th scope="col" className="min-w-44 px-3 py-2 text-left font-semibold">
                Kết quả chung
              </th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.group} className="border-t border-slate-200">
              <tr className="bg-slate-100">
                <th scope="rowgroup" colSpan={MONTHS.length + 2} className="sticky left-0 px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-800">
                  {g.label}
                </th>
              </tr>
              {g.checks.map((c) => {
                const rules = CHECK_RULES[c.id];
                // Chỉ phép kiểm có lệch mới có nút: luật có thể dùng chung với phép kiểm khác (ví dụ ba phép kiểm hệ thống cùng luật).
                const n = rules && c.status === "issue" ? related(rules) : 0;
                return (
                  <tr key={c.id} className="border-t border-slate-100 align-top">
                    <th scope="row" className="sticky left-0 z-10 min-w-64 bg-white px-3 py-1.5 text-left font-medium text-slate-900">
                      {c.label}
                      {c.detail ? <span className="mt-0.5 block text-xs font-normal text-slate-600">{c.detail}</span> : null}
                    </th>
                    {MONTHS.map((m) => (
                      <MonthCell key={m} check={c} month={m} />
                    ))}
                    <td className="px-3 py-1.5">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${STATUS_CHIP[c.status]}`}>
                        <span aria-hidden="true">{STATUS_MARK[c.status]}</span>
                        {STATUS_LABELS[c.status]}
                      </span>
                      {c.status === "issue" ? (
                        <span className="mt-0.5 block text-xs tabular-nums text-slate-800">
                          {c.issues.toLocaleString("vi-VN")} mục{c.amount > 0 ? ` · ${fmtMoney(c.amount)}đ` : ""}
                        </span>
                      ) : null}
                      {n > 0 ? (
                        <button
                          type="button"
                          onClick={() => onOpenRules(rules, c.label)}
                          className="mt-0.5 block text-xs font-medium text-indigo-800 underline hover:text-indigo-950"
                        >
                          Xem {n} phát hiện liên quan
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}
