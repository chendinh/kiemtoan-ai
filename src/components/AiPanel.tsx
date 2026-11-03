"use client";

import { SEVERITY_LABELS } from "@/lib/audit/catalog";
import type { AiReview, AiStatus, AuditRecord } from "@/lib/types";
import EvidenceTable from "./EvidenceTable";
import { Card, Notice, SeverityBadge, Spinner, buttonPrimary } from "./ui";

export interface AiState {
  state: "idle" | "loading" | "done" | "error";
  review?: AiReview;
  error?: string;
}

interface Props {
  status: AiStatus | null;
  ai: AiState;
  onRun: () => void;
  lookup: Map<string, AuditRecord>;
  onOpenFinding: (id: string) => void;
}

const RISK_LABEL = { low: "Thấp", medium: "Trung bình", high: "Cao" } as const;
const VERDICT_LABEL = {
  likely_issue: "Nhiều khả năng là vấn đề thật",
  needs_followup: "Cần theo dõi thêm",
  likely_benign: "Nhiều khả năng hợp lệ",
} as const;

export default function AiPanel({ status, ai, onRun, lookup, onOpenFinding }: Props) {
  if (status && !status.configured) {
    return (
      <Card className="space-y-2 p-5 text-sm text-slate-800">
        <p className="font-semibold text-slate-900">AI chưa được cấu hình.</p>
        <p>
          Tạo file <code className="rounded bg-slate-100 px-1">.env.local</code> ở thư mục gốc dự án (xem mẫu <code className="rounded bg-slate-100 px-1">.env.example</code>) với <code className="rounded bg-slate-100 px-1">AI_API_KEY</code> và{" "}
          <code className="rounded bg-slate-100 px-1">AI_MODEL</code>, rồi khởi động lại server. Có thể dùng OpenAI, các dịch vụ tương thích OpenAI (OpenRouter, Ollama chạy local...) hoặc Anthropic.
        </p>
        <p>Các luật logic ở các tab khác vẫn hoạt động đầy đủ khi không có AI.</p>
      </Card>
    );
  }

  if (ai.state === "idle") {
    return (
      <Card className="space-y-3 p-5 text-sm text-slate-800">
        <p>
          AI đọc tóm tắt kết quả, một số dòng liên quan và mẫu dữ liệu để nhận xét: phát hiện nào đáng lo, nên kiểm tra thủ tục gì, và có bất thường nào luật tự động chưa nêu. AI <strong>không thay thế</strong> kết quả của các luật logic và không được bỏ bớt phát hiện nào.
        </p>
        <p className="text-xs text-slate-600">Khi chạy, dữ liệu tóm tắt được gửi tới nhà cung cấp AI đã cấu hình ({status?.provider} · {status?.model}). Bật “Ẩn danh hóa” ở phần Cài đặt để thay tên đối tác bằng mã.</p>
        <button type="button" className={buttonPrimary} onClick={onRun} disabled={!status?.configured}>
          Chạy rà soát bằng AI
        </button>
      </Card>
    );
  }

  if (ai.state === "loading") {
    return (
      <Card className="flex items-center gap-3 p-5 text-sm text-slate-800" >
        <Spinner className="h-5 w-5 text-indigo-600" />
        <span role="status">AI đang rà soát kết quả, thường mất 20-60 giây…</span>
      </Card>
    );
  }

  if (ai.state === "error") {
    return (
      <div className="space-y-3">
        <Notice tone="error">{ai.error ?? "AI gặp lỗi."}</Notice>
        <button type="button" className={buttonPrimary} onClick={onRun}>
          Thử lại
        </button>
      </div>
    );
  }

  const r = ai.review as AiReview;
  return (
    <div className="space-y-4">
      <Notice tone="info">
        Nhận xét của AI ({r.provider} · {r.model}
        {r.anonymized ? ", dữ liệu đã ẩn danh hóa" : ", dữ liệu KHÔNG ẩn danh hóa"}) chỉ mang tính tham khảo. AI có thể sai hoặc thiếu ngữ cảnh; kiểm toán viên cần xác minh trên chứng từ gốc.
      </Notice>

      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-base font-semibold text-slate-900">Nhận định tổng quan</h3>
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-900 ring-1 ring-inset ring-violet-300">
            Mức rủi ro theo AI: {RISK_LABEL[r.riskLevel]}
          </span>
        </div>
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-800">{r.overallAssessment}</p>
        {r.rawText ? (
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-slate-700">Văn bản thô AI trả về</summary>
            <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-slate-800">{r.rawText}</pre>
          </details>
        ) : null}
      </Card>

      {r.findingReviews.length > 0 ? (
        <Card className="p-5">
          <h3 className="text-base font-semibold text-slate-900">Đánh giá từng phát hiện</h3>
          <ul className="mt-2 divide-y divide-slate-100">
            {r.findingReviews.map((fr) => (
              <li key={fr.findingId} className="py-3 text-sm text-slate-800">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => onOpenFinding(fr.findingId)} className="font-mono text-xs font-semibold text-indigo-800 underline">
                    {fr.findingId}
                  </button>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-800">{VERDICT_LABEL[fr.verdict]}</span>
                </div>
                {fr.comment ? <p className="mt-1">{fr.comment}</p> : null}
                {fr.procedures.length > 0 ? (
                  <ul className="mt-1 list-disc pl-5 text-slate-800">
                    {fr.procedures.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {r.additionalObservations.length > 0 ? (
        <Card className="p-5">
          <h3 className="text-base font-semibold text-slate-900">Bất thường bổ sung do AI nêu (luật tự động chưa bắt)</h3>
          <ul className="mt-2 space-y-4">
            {r.additionalObservations.map((o, i) => {
              const rows = o.recordIds.map((id) => lookup.get(id)).filter((x): x is AuditRecord => !!x);
              return (
                <li key={i} className="text-sm text-slate-800">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={o.severity} />
                    <span className="font-semibold text-slate-900">{o.title}</span>
                    <span className="sr-only">Mức {SEVERITY_LABELS[o.severity]}</span>
                  </div>
                  <p className="mt-1">{o.detail}</p>
                  {rows.length > 0 ? (
                    <div className="mt-2">
                      <EvidenceTable rows={rows.slice(0, 8)} caption={`Dòng liên quan tới: ${o.title}`} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {r.questions.length > 0 ? (
        <Card className="p-5">
          <h3 className="text-base font-semibold text-slate-900">Câu hỏi nên hỏi kế toán / ban giám đốc</h3>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-800">
            {r.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        </Card>
      ) : null}

      {r.limitations.length > 0 ? (
        <Card className="p-5">
          <h3 className="text-base font-semibold text-slate-900">Hạn chế của phân tích</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-800">
            {r.limitations.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <button type="button" className={buttonPrimary} onClick={onRun}>
        Chạy lại AI
      </button>
    </div>
  );
}
