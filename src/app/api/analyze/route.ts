import { NextResponse } from "next/server";
import { z } from "zod";
import { getAiConfig } from "@/lib/ai/config";
import { makeStructureResolver } from "@/lib/ai/resolver";
import { runAudit } from "@/lib/audit/engine";
import { SUPPORTED_EXTENSIONS, extensionOf, parseFile } from "@/lib/parsers";
import { DEFAULT_SETTINGS, type ParsedFile, type RoleSetting } from "@/lib/types";
import { todayIso } from "@/lib/util/values";

// Một năm của shop có khoảng 20 file (sổ, 8 bảng lô, 9-10 sao kê, file hệ thống), nên cho phép nhiều hơn mặc định chung.
const MAX_FILES = 40;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 120 * 1024 * 1024;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const settingsSchema = z.object({
  thresholds: z.array(z.number().positive().max(1e13)).max(12).default(DEFAULT_SETTINGS.thresholds),
  thresholdBandPct: z.number().min(0.5).max(50).default(DEFAULT_SETTINGS.thresholdBandPct),
  amountTolerance: z.number().min(0).max(1e9).default(DEFAULT_SETTINGS.amountTolerance),
  dateWindowDays: z.number().int().min(0).max(120).default(DEFAULT_SETTINGS.dateWindowDays),
  splitWindowDays: z.number().int().min(0).max(30).default(DEFAULT_SETTINGS.splitWindowDays),
  duplicateWindowDays: z.number().int().min(0).max(60).default(DEFAULT_SETTINGS.duplicateWindowDays),
  minAmount: z.number().min(0).max(1e12).default(DEFAULT_SETTINGS.minAmount),
  roundUnit: z.number().positive().max(1e12).default(DEFAULT_SETTINGS.roundUnit),
  periodFrom: isoDate.optional(),
  periodTo: isoDate.optional(),
  keywords: z.array(z.string().max(60)).max(30).default([]),
  shopMode: z.boolean().default(DEFAULT_SETTINGS.shopMode ?? true),
});

const rolesSchema = z.array(z.enum(["auto", "ledger", "bank", "invoice", "other"])).max(MAX_FILES);

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function jsonField(form: FormData, name: string): unknown {
  const raw = form.get(name);
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  return JSON.parse(raw);
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("Yêu cầu không hợp lệ: cần gửi multipart/form-data kèm các file.");
  }

  const uploads = form.getAll("files").filter((f): f is File => typeof f !== "string");
  if (uploads.length === 0) return fail("Chưa có file nào được gửi lên.");
  if (uploads.length > MAX_FILES) return fail(`Tối đa ${MAX_FILES} file mỗi lần phân tích.`);

  let total = 0;
  for (const f of uploads) {
    total += f.size;
    if (f.size > MAX_FILE_BYTES) return fail(`File "${f.name}" vượt quá ${MAX_FILE_BYTES / 1024 / 1024} MB.`, 413);
    if (!SUPPORTED_EXTENSIONS.includes(extensionOf(f.name))) {
      return fail(`File "${f.name}" có định dạng chưa hỗ trợ. Hỗ trợ: ${SUPPORTED_EXTENSIONS.join(", ")}.`, 415);
    }
  }
  if (total > MAX_TOTAL_BYTES) return fail(`Tổng dung lượng vượt quá ${MAX_TOTAL_BYTES / 1024 / 1024} MB.`, 413);

  let settings;
  let roles: RoleSetting[];
  try {
    settings = settingsSchema.parse(jsonField(form, "settings") ?? {});
    roles = rolesSchema.parse(jsonField(form, "roles") ?? []);
  } catch (e) {
    const detail = e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : "JSON không hợp lệ";
    return fail(`Cài đặt không hợp lệ (${detail}).`);
  }
  while (roles.length < uploads.length) roles.push("auto");

  // AI nhận diện bảng lạ là tùy chọn và chỉ chạy khi đã cấu hình khóa. AI chỉ đề xuất; mọi bố cục đều được code kiểm chứng trên dữ liệu thật.
  const wantAiStructure = form.get("aiStructure") === "1";
  const aiCfg = wantAiStructure ? getAiConfig() : null;
  const structure = wantAiStructure && aiCfg ? makeStructureResolver(aiCfg) : undefined;

  const parsed: ParsedFile[] = [];
  for (let i = 0; i < uploads.length; i++) {
    const buffer = Buffer.from(await uploads[i].arrayBuffer());
    parsed.push(await parseFile({ name: uploads[i].name, size: uploads[i].size, buffer }, i, { structure }));
  }

  const result = runAudit({ files: parsed, roleSettings: roles.slice(0, uploads.length), settings, today: todayIso() });
  const aiStructure = parsed.flatMap((f) => (f.aiStructure ?? []).map((n) => ({ ...n, fileId: f.fileId, fileName: f.fileName })));
  const aiStructureSkipped = wantAiStructure && !aiCfg ? "AI chưa được cấu hình (thiếu AI_API_KEY / AI_MODEL) nên chưa nhận diện được bảng lạ." : undefined;
  return NextResponse.json({ ...result, aiStructure, aiStructureSkipped }, { headers: { "Cache-Control": "no-store" } });
}
