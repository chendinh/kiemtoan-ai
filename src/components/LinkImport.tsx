"use client";

import { useId, useState } from "react";
import { Notice, Spinner, buttonSecondary, inputClass } from "./ui";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_LINKS_PER_RUN = 20;

interface Props {
  disabled?: boolean;
  /** Số file còn có thể thêm vào danh sách. */
  remaining: number;
  /** Tên và mã sheet của các file đang có, để tránh đặt trùng tên và để biết sheet nào cần làm mới. */
  existing: { name: string; sourceId?: string }[];
  onImported: (file: File, sourceId: string) => void;
}

/** Mã Google Sheet trong link, chỉ dùng để nhận ra cùng một sheet khi nhập lại. Việc kiểm tra thật do máy chủ làm. */
export function sheetIdOf(link: string): string | null {
  const m = /\/spreadsheets\/(?:u\/\d+\/)?d\/(e\/)?([A-Za-z0-9_-]{20,})/.exec(link);
  return m ? `${m[1] ?? ""}${m[2]}` : null;
}

/** Đổi tên để không trùng với các tên đã dùng: "Bảng.xlsx" → "Bảng (2).xlsx". */
function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 2; i < 100; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  return name;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string };
    if (j.error) return j.error;
  } catch {
    // không phải JSON
  }
  return `Máy chủ trả lỗi ${res.status}.`;
}

export default function LinkImport({ disabled, remaining, existing, onImported }: Props) {
  const areaId = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [messages, setMessages] = useState<{ tone: "error" | "warn" | "info"; text: string }[]>([]);

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  // Bỏ link trùng; hai link khác nhau nhưng cùng một mã sheet cũng chỉ tải một lần.
  const unique: string[] = [];
  const seenIds = new Set<string>();
  for (const l of lines) {
    const id = sheetIdOf(l);
    const key = id ?? l;
    if (seenIds.has(key)) continue;
    seenIds.add(key);
    unique.push(l);
  }

  const run = async () => {
    if (busy || unique.length === 0) return;
    setBusy(true);
    setMessages([]);
    const batch = unique.slice(0, MAX_LINKS_PER_RUN);
    const out: { tone: "error" | "warn" | "info"; text: string }[] = [];
    const failed: string[] = [];
    // Tên đã dùng: các file đang có (trừ chính file sẽ được làm mới) và các file vừa tải trong lần này.
    const taken = new Set(existing.map((e) => e.name));
    let added = 0;

    if (unique.length > batch.length) out.push({ tone: "warn", text: `Mỗi lần chỉ tải tối đa ${MAX_LINKS_PER_RUN} link; ${unique.length - batch.length} link còn lại giữ nguyên trong ô để tải tiếp.` });

    for (let i = 0; i < batch.length; i++) {
      const link = batch[i];
      setProgress(`Đang tải ${i + 1}/${batch.length}…`);
      const sourceId = sheetIdOf(link);
      const label = `Link ${i + 1}`;
      if (!sourceId) {
        out.push({ tone: "error", text: `${label}: không phải link Google Sheets (cần dạng …/spreadsheets/d/<mã>/…).` });
        failed.push(link);
        continue;
      }
      const replaces = existing.some((e) => e.sourceId === sourceId);
      if (!replaces && remaining - added <= 0) {
        out.push({ tone: "warn", text: `${label}: danh sách đã đủ số file tối đa nên chưa tải.` });
        failed.push(link);
        continue;
      }
      try {
        const res = await fetch("/api/import-link", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: link }),
        });
        if (!res.ok) {
          out.push({ tone: "error", text: `${label}: ${await errorMessage(res)}` });
          failed.push(link);
          continue;
        }
        const blob = await res.blob();
        let name = "";
        try {
          name = decodeURIComponent(res.headers.get("X-File-Name") ?? "");
        } catch {
          name = "";
        }
        if (!name) name = `google-sheet-${sourceId.replace(/^e\//, "").slice(0, 6)}.xlsx`;
        // Sheet đang có (nhập lại để làm mới) giữ tên cũ trong danh sách nên không tính là trùng với chính nó.
        const own = existing.find((e) => e.sourceId === sourceId)?.name;
        const finalName = own ?? uniqueName(name, taken);
        taken.add(finalName);
        onImported(new File([blob], finalName, { type: XLSX_MIME, lastModified: Date.now() }), sourceId);
        if (!replaces) added++;
      } catch {
        out.push({ tone: "error", text: `${label}: không kết nối được tới máy chủ. Thử lại.` });
        failed.push(link);
      }
    }

    const ok = batch.length - failed.length;
    if (ok > 0) out.unshift({ tone: "info", text: `Đã tải ${ok}/${batch.length} sheet vào danh sách file.` });
    setMessages(out);
    setText([...failed, ...unique.slice(batch.length)].join("\n"));
    setProgress("");
    setBusy(false);
  };

  return (
    <details className="mt-3 rounded-xl border border-slate-200 bg-white shadow-sm">
      <summary className="cursor-pointer rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-900">Hoặc nhập từ link Google Sheets</summary>
      <div className="space-y-3 border-t border-slate-100 p-4">
        <div>
          <label htmlFor={areaId} className="mb-1 block text-xs font-medium text-slate-700">
            Mỗi dòng một link (ví dụ https://docs.google.com/spreadsheets/d/…/edit)
          </label>
          <textarea
            id={areaId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            disabled={disabled || busy}
            spellCheck={false}
            placeholder="https://docs.google.com/spreadsheets/d/…"
            className={`${inputClass} font-mono text-xs`}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={buttonSecondary} disabled={disabled || busy || unique.length === 0} onClick={() => void run()}>
            {busy ? <Spinner /> : null}
            {busy ? "Đang tải…" : unique.length > 0 ? `Tải ${unique.length} sheet` : "Tải sheet"}
          </button>
          <span className="text-xs text-slate-700" aria-live="polite">
            {progress}
          </span>
        </div>
        <p className="text-xs text-slate-600">
          Sheet cần được chia sẻ “Bất kỳ ai có đường liên kết” (vai trò Người xem). Ứng dụng tải bản xlsx về để phân tích và không lưu lại. Lưu ý: link công khai cho phép bất kỳ ai có link đọc cả thông tin cá nhân của khách ký gửi trong sheet; nên đổi lại về chia sẻ riêng tư sau khi tải xong.
        </p>
        {messages.map((m, i) => (
          <Notice key={`${m.tone}-${i}`} tone={m.tone}>
            {m.text}
          </Notice>
        ))}
      </div>
    </details>
  );
}
