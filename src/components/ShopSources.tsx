"use client";

import { KIND_LABELS, type ShopSourceSummary, type ShopTableKind } from "@/lib/shop/types";
import type { AnalysisResult, AiStructureNote } from "@/lib/types";
import { Notice } from "./ui";

type AiNote = NonNullable<AnalysisResult["aiStructure"]>[number];

const AI_STATUS: Record<AiStructureNote["status"], { label: string; style: string }> = {
  accepted: { label: "Đã nhận", style: "bg-emerald-100 text-emerald-900 ring-emerald-300" },
  cached: { label: "Đã nhận (dùng lại bố cục đã duyệt)", style: "bg-emerald-100 text-emerald-900 ring-emerald-300" },
  rejected: { label: "Bị từ chối", style: "bg-amber-100 text-amber-900 ring-amber-300" },
  none: { label: "AI không nhận ra", style: "bg-slate-100 text-slate-800 ring-slate-300" },
  no_answer: { label: "Không có câu trả lời", style: "bg-slate-100 text-slate-800 ring-slate-300" },
};

function kindLabel(kind: string | undefined): string | undefined {
  if (!kind) return undefined;
  return KIND_LABELS[kind as ShopTableKind] ?? kind;
}

export default function ShopSources({ sources, ai, aiSkipped }: { sources: ShopSourceSummary[]; ai?: AiNote[]; aiSkipped?: string }) {
  const unknown = sources.reduce((s, x) => s + x.unknownTabs.length, 0);

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {sources.map((s) => (
          <li key={s.fileId} className="px-4 py-3 text-sm">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-semibold text-indigo-800">{s.fileId}</span>
              <span className="font-medium text-slate-900 [overflow-wrap:anywhere]">{s.fileName}</span>
            </div>
            {s.tabs.length > 0 ? (
              <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label={`Các loại bảng đã nhận diện trong ${s.fileName}`}>
                {s.tabs.map((t) => (
                  <li key={t.kind} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-800">
                    {t.label}: {t.count} tab{t.hidden > 0 ? ` (${t.hidden} ẩn)` : ""} · {t.rows.toLocaleString("vi-VN")} dòng
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-slate-600">Không nhận ra bảng nghiệp vụ nào của shop trong file này (sao kê ngân hàng và các bảng khác vẫn được đọc ở tab “Dữ liệu đã đọc”).</p>
            )}
            {s.unknownTabs.length > 0 ? (
              <details className="mt-2 text-xs text-slate-800">
                <summary className="cursor-pointer font-medium text-amber-900">
                  {s.unknownTabs.length} tab chưa nhận diện, không đưa vào kiểm tra
                </summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {s.unknownTabs.map((u) => (
                    <li key={u.sheet}>
                      Tab “{u.sheet}”{u.hidden ? " (ẩn)" : ""}: {u.rows.toLocaleString("vi-VN")} dòng
                      {u.headers.length > 0 ? `, tiêu đề cột: ${u.headers.join(" · ")}` : ", không đọc được tiêu đề cột"}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </li>
        ))}
      </ul>

      {unknown > 0 && !ai?.length && !aiSkipped ? (
        <p className="text-xs text-slate-700">
          Có {unknown} tab chưa nhận diện. Nếu đó là bảng thật của shop (ví dụ tab đổi tiêu đề cột hoặc thêm cột), bật “AI nhận diện bảng lạ” ở phần Cài đặt rồi phân tích lại: AI chỉ đề xuất cách đọc, còn code kiểm chứng lại trên dữ liệu thật trước khi dùng.
        </p>
      ) : null}

      {aiSkipped ? <Notice tone="warn">{aiSkipped}</Notice> : null}

      {ai && ai.length > 0 ? (
        <div>
          <h4 className="text-sm font-semibold text-slate-900">AI nhận diện bảng lạ</h4>
          <p className="mt-0.5 text-xs text-slate-700">
            AI chỉ nhận hồ sơ cột (nhãn tiêu đề, thống kê, mẫu hình ký tự), không nhận giá trị ô. Đề xuất của AI chỉ được dùng khi code kiểm chứng đạt trên dữ liệu thật.
          </p>
          <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {ai.map((n, i) => {
              const st = AI_STATUS[n.status];
              const kind = kindLabel(n.kind);
              return (
                <li key={`${n.fileId}-${n.sheet}-${i}`} className="px-4 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${st.style}`}>{st.label}</span>
                    <span className="text-slate-900">
                      {n.fileId} · tab “{n.sheet}”
                    </span>
                    {kind ? <span className="text-xs text-slate-700">→ {kind}{typeof n.rows === "number" ? `, ${n.rows.toLocaleString("vi-VN")} dòng` : ""}</span> : null}
                  </div>
                  {n.message ? <p className="mt-1 text-xs text-slate-700">{n.message}</p> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
