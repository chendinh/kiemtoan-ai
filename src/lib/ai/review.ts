// Điều phối một lần AI rà soát: dựng lời nhắc, gọi mô hình, kiểm tra và làm sạch kết quả.

import type { AiReview } from "@/lib/types";
import { Anonymizer } from "./anonymize";
import { type AiConfig } from "./config";
import { buildPrompt } from "./prompt";
import { callModel } from "./provider";
import { type AiRequest, aiOutputSchema } from "./schema";

function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** `call` chỉ để kiểm thử (thay mô hình thật bằng mô hình giả); mặc định gọi mô hình đã cấu hình. */
export async function reviewWithAi(
  cfg: AiConfig,
  req: AiRequest,
  call: (system: string, user: string) => Promise<string> = (system, user) => callModel(cfg, { system, user }),
): Promise<AiReview> {
  const anon = new Anonymizer(req.anonymize);
  const built = buildPrompt(req, anon);
  const raw = await call(built.system, built.user);

  const base = { provider: cfg.provider, model: cfg.model, anonymized: req.anonymize };
  const json = extractJson(raw);
  const parsed = json ? aiOutputSchema.safeParse(json) : null;

  if (!parsed || !parsed.success) {
    return {
      ...base,
      overallAssessment: anon.restore(raw).slice(0, 4000),
      riskLevel: "medium",
      findingReviews: [],
      additionalObservations: [],
      questions: [],
      limitations: ["AI không trả về đúng định dạng JSON nên chỉ hiển thị văn bản thô."],
      rawText: anon.restore(raw).slice(0, 8000),
    };
  }

  const out = parsed.data;
  const clean = (s: string, max: number) => anon.restore(s).trim().slice(0, max);
  return {
    ...base,
    overallAssessment: clean(out.overallAssessment, 3000),
    riskLevel: out.riskLevel,
    findingReviews: out.findingReviews
      .filter((r) => built.findingIds.has(r.findingId))
      .slice(0, 25)
      .map((r) => ({
        findingId: r.findingId,
        verdict: r.verdict,
        comment: clean(r.comment, 1200),
        procedures: r.procedures.slice(0, 6).map((p) => clean(p, 400)),
      })),
    additionalObservations: out.additionalObservations
      .filter((o) => o.title.trim() !== "")
      .slice(0, 8)
      .map((o) => ({
        title: clean(o.title, 200),
        detail: clean(o.detail, 1500),
        severity: o.severity,
        recordIds: o.recordIds.filter((id) => built.recordIds.has(id)).slice(0, 20),
      })),
    questions: out.questions.slice(0, 10).map((q) => clean(q, 400)),
    limitations: out.limitations.slice(0, 6).map((l) => clean(l, 400)),
  };
}
