"use client";

import type { BenfordResult, BenfordSkipped } from "@/lib/types";
import { fmtPct } from "@/lib/util/stats";
import { Card } from "./ui";

const CONFORMITY_LABEL: Record<BenfordResult["conformity"], { text: string; style: string }> = {
  close: { text: "Rất khớp Benford", style: "bg-emerald-100 text-emerald-900 ring-emerald-300" },
  acceptable: { text: "Chấp nhận được", style: "bg-emerald-100 text-emerald-900 ring-emerald-300" },
  marginal: { text: "Ở ranh giới", style: "bg-amber-100 text-amber-900 ring-amber-300" },
  nonconforming: { text: "Không phù hợp Benford", style: "bg-red-100 text-red-800 ring-red-300" },
};

function Chart({ r }: { r: BenfordResult }) {
  const W = 520;
  const H = 250;
  const L = 46;
  const Rm = 12;
  const T = 14;
  const B = 42;
  const plotW = W - L - Rm;
  const plotH = H - T - B;
  const maxP = Math.max(0.35, ...r.observed, ...r.expected);
  const step = plotW / 9;
  const cx = (i: number) => L + (i + 0.5) * step;
  const y = (p: number) => T + plotH * (1 - p / maxP);
  const ticks = [0, 0.1, 0.2, 0.3].filter((t) => t <= maxP);
  const label = `Biểu đồ chữ số đầu của ${r.fileName}: cột là tỷ lệ thực tế, chấm là tỷ lệ kỳ vọng theo Benford.`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full max-w-xl">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - Rm} y1={y(t)} y2={y(t)} stroke="#e2e8f0" />
          <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#475569">
            {Math.round(t * 100)}%
          </text>
        </g>
      ))}
      {r.observed.map((p, i) => (
        <g key={i}>
          <rect x={cx(i) - step * 0.3} y={y(p)} width={step * 0.6} height={plotH * (p / maxP)} rx="2" fill="#4f46e5" />
          <text x={cx(i)} y={H - B + 16} textAnchor="middle" fontSize="12" fill="#0f172a">
            {i + 1}
          </text>
          <text x={cx(i)} y={y(p) - 4} textAnchor="middle" fontSize="10" fill="#334155">
            {(p * 100).toFixed(1)}
          </text>
        </g>
      ))}
      <polyline fill="none" stroke="#d97706" strokeWidth="2" points={r.expected.map((p, i) => `${cx(i)},${y(p)}`).join(" ")} />
      {r.expected.map((p, i) => (
        <circle key={i} cx={cx(i)} cy={y(p)} r="3.5" fill="#d97706" stroke="#fff" strokeWidth="1" />
      ))}
      <text x={L + plotW / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="#475569">
        Chữ số đầu tiên của số tiền
      </text>
      <rect x={W - 250} y={T} width="10" height="10" fill="#4f46e5" rx="2" />
      <text x={W - 236} y={T + 9} fontSize="11" fill="#0f172a">
        Thực tế
      </text>
      <circle cx={W - 172} cy={T + 5} r="4" fill="#d97706" />
      <text x={W - 164} y={T + 9} fontSize="11" fill="#0f172a">
        Kỳ vọng Benford
      </text>
    </svg>
  );
}

export default function BenfordPanel({ results, skipped }: { results: BenfordResult[]; skipped: BenfordSkipped[] }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-700">
        Quy luật Benford: trong số liệu kế toán phát sinh tự nhiên, chữ số đầu là 1 chiếm khoảng 30%, chữ số 9 chỉ khoảng 5%. Độ lệch lớn gợi ý số liệu bị tạo hoặc bị chỉnh, nhưng đây chỉ là chỉ báo để chọn mẫu kiểm tra. Cần ít nhất 100 giao dịch mỗi file; kết luận chỉ đưa ra khi độ lệch có ý nghĩa thống kê (chi-square &gt; 20,09).
      </p>

      {results.length === 0 ? (
        <Card className="p-4 text-sm text-slate-800">Chưa file nào đủ 100 giao dịch để kiểm định Benford.</Card>
      ) : null}

      {results.map((r) => {
        const c = CONFORMITY_LABEL[r.conformity];
        return (
          <Card key={r.fileId} className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-base font-semibold text-slate-900">
                <span className="mr-2 rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-semibold text-indigo-800">{r.fileId}</span>
                {r.fileName}
              </h3>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${c.style}`}>{c.text}</span>
              <span className="text-xs text-slate-700">
                {r.n.toLocaleString("vi-VN")} giao dịch · MAD {r.mad.toFixed(4)} · chi-square {r.chiSquare.toFixed(1)}
              </span>
            </div>
            <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
              <Chart r={r} />
              <div role="region" aria-label={`Bảng phân phối chữ số đầu của ${r.fileName}`} tabIndex={0} className="overflow-x-auto">
                <table className="text-sm">
                  <caption className="sr-only">Phân phối chữ số đầu của {r.fileName}</caption>
                  <thead>
                    <tr className="text-left text-xs text-slate-700">
                      <th scope="col" className="px-2 py-1">
                        Chữ số
                      </th>
                      <th scope="col" className="px-2 py-1 text-right">
                        Số dòng
                      </th>
                      <th scope="col" className="px-2 py-1 text-right">
                        Thực tế
                      </th>
                      <th scope="col" className="px-2 py-1 text-right">
                        Kỳ vọng
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.observed.map((p, i) => {
                      const over = r.digitFlags.some((f) => f.digit === i + 1);
                      return (
                        <tr key={i} className={over ? "bg-amber-50 font-medium" : undefined}>
                          <th scope="row" className="px-2 py-1 text-left">
                            {i + 1}
                            {over ? <span className="sr-only"> (cao hơn kỳ vọng có ý nghĩa)</span> : null}
                          </th>
                          <td className="px-2 py-1 text-right tabular-nums">{r.counts[i]}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{fmtPct(p)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{fmtPct(r.expected[i])}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="mt-1 text-xs text-slate-600">Dòng nền vàng: cao hơn kỳ vọng có ý nghĩa thống kê (z &gt; 1,96).</p>
              </div>
            </div>
            {r.pairSpikes.length > 0 ? (
              <p className="mt-3 text-sm text-slate-800">
                <span className="font-semibold">Cặp hai chữ số đầu nổi bật: </span>
                {r.pairSpikes.map((s) => `${s.pair} (${s.count} dòng, ${fmtPct(s.observed, 2)} so với ${fmtPct(s.expected, 2)})`).join("; ")}
              </p>
            ) : null}
          </Card>
        );
      })}

      {skipped.length > 0 ? (
        <Card className="p-4 text-sm text-slate-800">
          <span className="font-semibold">Không đủ dữ liệu để kiểm định: </span>
          {skipped.map((s) => `${s.fileId} (${s.n} giao dịch)`).join(", ")}.
        </Card>
      ) : null}
    </div>
  );
}
