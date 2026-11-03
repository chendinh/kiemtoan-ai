// Gọi mô hình ngôn ngữ qua HTTP thuần: API tương thích OpenAI (OpenAI, OpenRouter, Azure, Ollama, Groq...) hoặc Anthropic.

import type { AiConfig } from "./config";

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

export interface ModelRequest {
  system: string;
  user: string;
}

async function post(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new AiProviderError(`AI không phản hồi sau ${Math.round(timeoutMs / 1000)} giây.`);
    throw new AiProviderError(`Không kết nối được tới máy chủ AI: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function errorText(res: Response): Promise<string> {
  const t = await res.text().catch(() => "");
  return t.replace(/\s+/g, " ").slice(0, 400);
}

async function callOpenAi(cfg: AiConfig, req: ModelRequest): Promise<string> {
  const url = `${cfg.baseUrl}/chat/completions`;
  const headers = { authorization: `Bearer ${cfg.apiKey}` };
  const base = {
    model: cfg.model,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
  };

  let res = await post(url, headers, { ...base, response_format: { type: "json_object" } }, cfg.timeoutMs);
  if (res.status === 400) {
    const t = await errorText(res);
    if (/response_format|json_object|json mode/i.test(t)) {
      // Một số máy chủ tương thích không hỗ trợ JSON mode: thử lại không có.
      res = await post(url, headers, base, cfg.timeoutMs);
    } else {
      throw new AiProviderError(`AI trả lỗi 400: ${t}`, 400);
    }
  }
  if (!res.ok) throw new AiProviderError(`AI trả lỗi ${res.status}: ${await errorText(res)}`, res.status);

  const data = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string | null } }[];
  } | null;
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new AiProviderError("AI trả về nội dung rỗng.");
  return text;
}

async function callAnthropic(cfg: AiConfig, req: ModelRequest): Promise<string> {
  const res = await post(
    `${cfg.baseUrl}/v1/messages`,
    { "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" },
    {
      model: cfg.model,
      max_tokens: 4096,
      system: req.system,
      messages: [{ role: "user", content: req.user }],
    },
    cfg.timeoutMs,
  );
  if (!res.ok) throw new AiProviderError(`AI trả lỗi ${res.status}: ${await errorText(res)}`, res.status);
  const data = (await res.json().catch(() => null)) as { content?: { type: string; text?: string }[] } | null;
  const text = (data?.content ?? [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("");
  if (!text) throw new AiProviderError("AI trả về nội dung rỗng.");
  return text;
}

export function callModel(cfg: AiConfig, req: ModelRequest): Promise<string> {
  return cfg.provider === "anthropic" ? callAnthropic(cfg, req) : callOpenAi(cfg, req);
}
