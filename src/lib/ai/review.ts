// Điều phối một lần AI rà soát: dựng lời nhắc, gọi mô hình, kiểm tra và làm sạch kết quả.
//
// Rà soát nhiều phát hiện trong MỘT lời gọi cho đầu ra quá dài: mô hình bị cắt ở giới hạn đầu ra, JSON hỏng và toàn bộ nhận định mất
// (đã gặp với 34 phát hiện: ~100 giây rồi chỉ còn văn bản thô). Vì vậy khi có nhiều phát hiện, chia thành một lời gọi tổng quan và
// nhiều lời gọi nhận định theo nhóm nhỏ, chạy song song. Một nhóm lỗi không làm mất các nhóm còn lại.
import type { AiReview } from "@/lib/types";
import { Anonymizer } from "./anonymize";
import { type AiConfig } from "./config";
import { MAX_FINDINGS, type PromptOptions, buildPrompt } from "./prompt";
import { callModel } from "./provider";
import { type AiRequest, aiOutputSchema } from "./schema";
/** Số phát hiện nhận định trong mỗi lời gọi, và số phát hiện tối đa để vẫn dùng một lời gọi duy nhất. */
const CHUNK_SIZE = 6;
const SINGLE_CALL_MAX = 8;
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
type Output = ReturnType<typeof aiOutputSchema.parse>;
interface Part {
  out: Output | null;
  raw: string;
  findingIds: Set<string>;
  recordIds: Set<string>;
  error?: string;
}
/** `call` chỉ để kiểm thử (thay mô hình thật bằng mô hình giả); mặc định gọi mô hình đã cấu hình. */
export async function reviewWithAi(
  cfg: AiConfig,
  req: AiRequest,
  call: (system: string, user: string) => Promise<string> = (system, user) => callModel(cfg, { system, user }),
): Promise<AiReview> {
  const anon = new Anonymizer(req.anonymize);
  const base = { provider: cfg.provider, model: cfg.model, anonymized: req.anonymize };
  const reviewable = req.analysis.findings.slice(0, MAX_FINDINGS).map((f) => f.id);
  const plan: PromptOptions[] =
    reviewable.length <= SINGLE_CALL_MAX
      ? [{ mode: "all" }]
      : [
          { mode: "overview" },
          ...Array.from({ length: Math.ceil(reviewable.length / CHUNK_SIZE) }, (_, i) => ({
            mode: "findings" as const,
            only: reviewable.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
          })),
        ];
  // Dựng lời nhắc tuần tự (Anonymizer dùng chung để mã đối tác nhất quán), gọi mô hình song song.
  const built = plan.map((opts) => buildPrompt(req, anon, opts));
  const parts: Part[] = await Promise.all(
    built.map(async (b): Promise<Part> => {
      const common = { findingIds: b.findingIds, recordIds: b.recordIds };
      try {
        const raw = await call(b.system, b.user);
        const json = extractJson(raw);
        const parsed = json ? aiOutputSchema.safeParse(json) : null;
        return { ...common, out: parsed && parsed.success ? parsed.data : null, raw };
      } catch (e) {
        return { ...common, out: null, raw: "", error: e instanceof Error ? e.message : "AI gặp lỗi." };
      }
    }),
  );
  // Nếu mọi lời gọi đều lỗi thật (không phải chỉ sai định dạng) thì báo lỗi lên trên thay vì trả kết quả rỗng.
  if (parts.every((p) => p.error)) throw new Error(parts[0].error);
  const clean = (s: string, max: number) => anon.restore(s).trim().slice(0, max);
  const limitations: string[] = [];
  const failed = parts.filter((p) => !p.out);
  if (failed.length > 0) {
    limitations.push(
      failed.length === parts.length
        ? "AI không trả về đúng định dạng JSON nên chỉ hiển thị văn bản thô."
        : `${failed.length}/${parts.length} phần của lần rà soát AI không dùng được (lỗi hoặc sai định dạng); các phần còn lại vẫn hiển thị.${
            failed.find((p) => p.error) ? ` Lỗi: ${failed.find((p) => p.error)?.error}` : ""
          }`,
    );
  }
  const ok = parts.filter((p): p is Part & { out: Output } => p.out !== null);
  if (ok.length === 0) {
    const raw = parts.map((p) => p.raw).join("\n\n");
    return {
      ...base,
      overallAssessment: anon.restore(raw).slice(0, 4000),
      riskLevel: "medium",
      findingReviews: [],
      additionalObservations: [],
      questions: [],
      limitations,
      rawText: anon.restore(raw).slice(0, 8000),
    };
  }
  const main = ok.find((p) => p.out.overallAssessment.trim() !== "") ?? ok[0];
  const seen = new Set<string>();
  const findingReviews = ok
    .flatMap((p) => p.out.findingReviews.filter((r) => p.findingIds.has(r.findingId)))
    .filter((r) => (seen.has(r.findingId) ? false : (seen.add(r.findingId), true)))
    .slice(0, MAX_FINDINGS)
    .map((r) => ({
      findingId: r.findingId,
      verdict: r.verdict,
      comment: clean(r.comment, 1200),
      procedures: r.procedures.slice(0, 6).map((p) => clean(p, 400)),
    }));
  const allRecordIds = new Set(ok.flatMap((p) => [...p.recordIds]));
  return {
    ...base,
    overallAssessment: clean(main.out.overallAssessment, 3000),
    riskLevel: main.out.riskLevel,
    findingReviews,
    additionalObservations: ok
      .flatMap((p) => p.out.additionalObservations)
      .filter((o) => o.title.trim() !== "")
      .slice(0, 8)
      .map((o) => ({
        title: clean(o.title, 200),
        detail: clean(o.detail, 1500),
        severity: o.severity,
        recordIds: o.recordIds.filter((id) => allRecordIds.has(id)).slice(0, 20),
      })),
    questions: ok.flatMap((p) => p.out.questions).slice(0, 10).map((q) => clean(q, 400)),
    limitations: [...limitations, ...ok.flatMap((p) => p.out.limitations)].slice(0, 6).map((l) => clean(l, 400)),
  };
}
