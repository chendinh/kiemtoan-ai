// Cấu hình AI đọc từ biến môi trường (chỉ chạy trên server, khóa API không bao giờ gửi xuống trình duyệt).

import type { AiStatus } from "@/lib/types";

export interface AiConfig {
  provider: "openai" | "anthropic";
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
}

function validBaseUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    const isLocal = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
    if (u.protocol === "https:" || (u.protocol === "http:" && isLocal)) return raw.replace(/\/+$/, "");
  } catch {
    // bỏ qua
  }
  return null;
}

export function getAiConfig(): AiConfig | null {
  const apiKey = process.env.AI_API_KEY?.trim();
  const model = process.env.AI_MODEL?.trim();
  if (!apiKey || !model) return null;

  const provider = (process.env.AI_PROVIDER ?? "openai").trim().toLowerCase() === "anthropic" ? "anthropic" : "openai";
  const defaultUrl = provider === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1";
  const baseUrl = validBaseUrl(process.env.AI_BASE_URL?.trim() || defaultUrl);
  if (!baseUrl) return null;

  const timeout = Number(process.env.AI_TIMEOUT_MS);
  return {
    provider,
    apiKey,
    model,
    baseUrl,
    timeoutMs: Number.isFinite(timeout) && timeout >= 5_000 ? Math.min(timeout, 600_000) : 180_000,
  };
}

export function getAiStatus(): AiStatus {
  const c = getAiConfig();
  if (!c) return { configured: false };
  return { configured: true, provider: c.provider, model: c.model };
}
