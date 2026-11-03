"use client";

import { useId, useState } from "react";
import { CATEGORY_LABELS, RULE_CATALOG } from "@/lib/audit/catalog";
import type { AiFindingReview, AuditRecord, Finding } from "@/lib/types";
import { resolveRows } from "@/lib/client/evidence";
import { fmtMoney } from "@/lib/util/stats";
import EvidenceTable from "./EvidenceTable";
import { SeverityBadge, buttonSecondary } from "./ui";

interface Props {
  finding: Finding;
  lookup: Map<string, AuditRecord>;
  reviewed: boolean;
  onToggleReviewed: () => void;
  aiReview?: AiFindingReview;
}

const VERDICT: Record<AiFindingReview["verdict"], { label: string; style: string }> = {
  likely_issue: { label: "AI: nhiều khả năng là vấn đề thật", style: "bg-red-100 text-red-900 ring-red-300" },
  needs_followup: { label: "AI: cần theo dõi thêm", style: "bg-amber-100 text-amber-900 ring-amber-300" },
  likely_benign: { label: "AI: nhiều khả năng hợp lệ", style: "bg-emerald-100 text-emerald-900 ring-emerald-300" },
};

const PREVIEW_ROWS = 12;

export default function FindingCard({ finding: f, lookup, reviewed, onToggleReviewed, aiReview }: Props) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const tableId = useId();
  const info = RULE_CATALOG[f.rule];
  const rows = open ? resolveRows(f, lookup) : [];
  const shown = all ? rows : rows.slice(0, PREVIEW_ROWS);

  return (
    <article id={`finding-${f.id}`} className={`rounded-xl border bg-white shadow-sm ${reviewed ? "border-slate-200 opacity-75" : "border-slate-300"}`}>
      <header className="flex flex-wrap items-start gap-3 p-4 pb-2">
        <SeverityBadge severity={f.severity} />
        <div className="min-w-0 flex-1">
          <div className="text-xs text-slate-600">
            <span className="font-mono">{f.id}</span> · {CATEGORY_LABELS[info.category]} · {info.label}
          </div>
          <h3 className="text-base font-semibold text-slate-900">{f.title}</h3>
        </div>
        <div className="text-right text-xs text-slate-600">
          {f.amount > 0 ? <div className="text-sm font-semibold tabular-nums text-slate-900">{fmtMoney(f.amount)} đ</div> : null}
          {f.totalRecords > 0 ? <div>{f.totalRecords.toLocaleString("vi-VN")} dòng liên quan</div> : null}
        </div>
      </header>

      <div className="space-y-3 px-4 pb-4">
        <p className="text-sm leading-relaxed text-slate-800">{f.description}</p>
        {f.recommendation ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-800">
            <span className="font-semibold">Nên làm: </span>
            {f.recommendation}
          </p>
        ) : null}

        <details className="text-sm">
          <summary className="cursor-pointer font-medium text-indigo-800">Vì sao đáng chú ý?</summary>
          <p className="mt-1 text-slate-800">{info.why}</p>
        </details>

        {aiReview ? (
          <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-slate-900">
            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${VERDICT[aiReview.verdict].style}`}>
              {VERDICT[aiReview.verdict].label}
            </span>
            {aiReview.comment ? <p className="mt-1">{aiReview.comment}</p> : null}
            {aiReview.procedures.length > 0 ? (
              <ul className="mt-1 list-disc pl-5">
                {aiReview.procedures.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {f.evidence.length > 0 ? (
          <div className="space-y-2">
            <button
              type="button"
              className={buttonSecondary}
              aria-expanded={open}
              aria-controls={tableId}
              onClick={() => {
                setOpen((v) => !v);
                setAll(false);
              }}
            >
              {open ? "Ẩn bằng chứng" : `Xem bằng chứng (${f.totalRecords.toLocaleString("vi-VN")} dòng)`}
            </button>
            <div id={tableId} className="space-y-2">
              {open ? (
                <>
                  <EvidenceTable rows={shown} caption={`Bằng chứng của ${f.id}: ${f.title}`} />
                  {rows.length > PREVIEW_ROWS && !all ? (
                    <button type="button" className={buttonSecondary} onClick={() => setAll(true)}>
                      Hiện tất cả {rows.length.toLocaleString("vi-VN")} dòng
                    </button>
                  ) : null}
                  {f.totalRecords > rows.length ? (
                    <p className="text-xs text-slate-600">
                      Chỉ hiển thị {rows.length.toLocaleString("vi-VN")}/{f.totalRecords.toLocaleString("vi-VN")} dòng liên quan; các dòng còn lại nằm ngoài phần dữ liệu được trả về.
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-800">
          <input type="checkbox" checked={reviewed} onChange={onToggleReviewed} className="h-4 w-4 rounded border-slate-400 text-indigo-600" />
          Đã xem xét phát hiện này
        </label>
      </div>
    </article>
  );
}
