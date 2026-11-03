"use client";

import { useMemo, useState } from "react";
import { MONTHS, groupFigures } from "@/lib/shop/checks";
import type { ShopFigure } from "@/lib/shop/types";
import { fmtMoney } from "@/lib/util/stats";

type Unit = "million" | "vnd";

const UNIT_LABEL: Record<Unit, string> = { million: "Triệu đồng", vnd: "Đồng" };

function fmtFigure(v: number | undefined, unit: Unit): string {
  if (v === undefined) return "–";
  if (unit === "vnd") return fmtMoney(v);
  return (v / 1_000_000).toLocaleString("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export default function ShopFigures({ figures, year }: { figures: ShopFigure[]; year: number }) {
  const [unit, setUnit] = useState<Unit>("million");
  const groups = useMemo(() => groupFigures(figures), [figures]);
  if (figures.length === 0) return null;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-xs text-slate-700">
          Mỗi nhóm gồm những số đo cùng một việc từ các nguồn khác nhau. Chênh nhau chưa chắc là sai (mỗi nguồn có thể tính theo ngày chuyển, ngày ghi hoặc đợt khác nhau); kết luận nằm ở bảng phép kiểm phía trên. Dấu – là tháng nguồn đó không có số.
        </p>
        <div role="group" aria-label="Đơn vị hiển thị" className="inline-flex overflow-hidden rounded-lg border border-slate-300">
          {(["million", "vnd"] as const).map((u) => (
            <button
              key={u}
              type="button"
              aria-pressed={unit === u}
              onClick={() => setUnit(u)}
              className={`px-3 py-1.5 text-xs font-semibold ${unit === u ? "bg-indigo-600 text-white" : "bg-white text-slate-800 hover:bg-slate-50"}`}
            >
              {UNIT_LABEL[u]}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[60rem] border-collapse text-sm">
          <caption className="sr-only">
            Số liệu theo tháng của năm {year} lấy từ từng nguồn, đơn vị {UNIT_LABEL[unit].toLowerCase()}.
          </caption>
          <thead className="bg-slate-50 text-xs text-slate-700">
            <tr>
              <th scope="col" className="sticky left-0 z-10 min-w-64 bg-slate-50 px-3 py-2 text-left font-semibold">
                Số liệu · nguồn
              </th>
              {MONTHS.map((m) => (
                <th key={m} scope="col" className="px-2 py-2 text-right font-semibold">
                  T{m}
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.title} className="border-t border-slate-200">
              <tr className="bg-slate-100">
                <th scope="rowgroup" colSpan={MONTHS.length + 1} className="sticky left-0 px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-800">
                  {g.title}
                </th>
              </tr>
              {g.figures.map((f) => (
                <tr key={f.id} className="border-t border-slate-100">
                  <th scope="row" className="sticky left-0 z-10 min-w-64 bg-white px-3 py-1.5 text-left font-medium text-slate-900">
                    {f.label}
                    <span className="block text-xs font-normal text-slate-600">{f.source}</span>
                  </th>
                  {MONTHS.map((m) => {
                    const v = f.months[m];
                    return (
                      <td key={m} className={`px-2 py-1.5 text-right tabular-nums ${v === undefined ? "text-slate-500" : v < 0 ? "text-red-800" : "text-slate-900"}`} title={v === undefined ? undefined : `${fmtMoney(v)} đồng`}>
                        {fmtFigure(v, unit)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}
