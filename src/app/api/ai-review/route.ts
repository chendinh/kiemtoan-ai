import { NextResponse, connection } from "next/server";
import { getAiConfig, getAiStatus } from "@/lib/ai/config";
import { AiProviderError } from "@/lib/ai/provider";
import { reviewWithAi } from "@/lib/ai/review";
import { aiRequestSchema } from "@/lib/ai/schema";

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const NO_STORE = { "Cache-Control": "no-store" };

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE });
}

/** Cho giao diện biết AI đã cấu hình chưa (không lộ khóa API). */
export async function GET() {
  await connection();
  return NextResponse.json(getAiStatus(), { headers: NO_STORE });
}

export async function POST(request: Request) {
  const cfg = getAiConfig();
  if (!cfg) {
    return fail("AI chưa được cấu hình. Đặt AI_API_KEY và AI_MODEL trong file .env.local rồi khởi động lại server.", 503);
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return fail("Dữ liệu gửi lên quá lớn.", 413);

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return fail("Dữ liệu gửi lên quá lớn.", 413);

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail("Nội dung yêu cầu không phải JSON hợp lệ.", 400);
  }
  const parsed = aiRequestSchema.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return fail(`Dữ liệu phân tích không hợp lệ (${detail}).`, 400);
  }

  try {
    const review = await reviewWithAi(cfg, parsed.data);
    return NextResponse.json(review, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof AiProviderError) return fail(e.message, 502);
    return fail("Không thể hoàn tất phần rà soát bằng AI.", 500);
  }
}
