import { NextResponse } from "next/server";
import { z } from "zod";
import { ImportError, XLSX_MIME, downloadSheet, parseSheetLink } from "@/lib/import/google-sheets";

const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 40_000;

const bodySchema = z.object({ url: z.string().min(1).max(2048) });

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Tải một Google Sheet (đã chia sẻ bằng link) về dạng xlsx để đưa vào phân tích như file tải lên.
 * Trả nội dung nhị phân; tên file nằm ở header X-File-Name (đã mã hóa URL).
 */
export async function POST(request: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return fail("Yêu cầu không hợp lệ: cần gửi JSON dạng {\"url\": \"…\"}.", 400);
  }

  try {
    const ref = parseSheetLink(body.url);
    const { buffer, filename } = await downloadSheet(ref, { maxBytes: MAX_BYTES, timeoutMs: TIMEOUT_MS });
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": XLSX_MIME,
        "Content-Length": String(buffer.length),
        "X-File-Name": encodeURIComponent(filename),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ImportError) return fail(e.message, e.status);
    return fail("Không tải được sheet. Thử lại sau.", 500);
  }
}
