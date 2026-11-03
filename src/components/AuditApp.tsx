"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_FORM, type SettingsForm, formToSettings } from "@/lib/client/settings";
import { SHOP_FROM, SHOP_YEAR } from "@/lib/shop/period";
import type { AiStatus, AnalysisResult, RoleSetting } from "@/lib/types";
import { fmtDate } from "@/lib/util/stats";
import { type AiState } from "./AiPanel";
import FileDropzone, { type FileItem, MAX_FILES } from "./FileDropzone";
import LinkImport from "./LinkImport";
import ResultsView from "./ResultsView";
import SettingsPanel from "./SettingsPanel";
import { Card, Notice, Spinner, buttonPrimary, buttonSecondary } from "./ui";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED = ["xlsx", "xlsm", "xlsb", "xls", "ods", "csv", "txt", "tsv", "pdf", "docx", "doc"];

const SAMPLES = [
  {
    name: "so-tien-gui-tk112-10-2025.xlsx",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  { name: "sao-ke-vietcombank-10-2025.csv", type: "text/csv" },
  {
    name: "bang-ke-hoa-don-mua-vao-10-2025.xlsx",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
];

const SHOP_CHECKS = [
  "Bảng lô: tiền đã chuyển so với số phải trả, lô đến hạn chưa thấy chuyển khoản, dòng chuyển khoản ghi trùng hoặc không có lô",
  "Ô tổng của bảng lô: SUM bỏ sót dòng, ô tiền lưu dạng chữ, ô gõ tay lệch",
  "File xuất từ hệ thống: đơn “Đã trả” có chuyển khoản chưa, đơn còn “Chưa trả” dù đã chuyển, đơn thiếu trong bảng lô",
  "Sổ thu chi: số dư cộng đúng, nối giữa các tháng, ô nháp ngoài sổ, số dư âm, khoản ghi hai lần",
  "Chi trả theo ngày: sổ thu chi, danh sách chuyển khoản và tab tổng hợp ngày có khớp nhau không",
  "Sao kê ngân hàng: số dư nối liên tục, tháng nào còn thiếu sao kê, khoản nhận trong sổ có lệnh chuyển tương ứng không",
  "Báo cáo tháng và doanh thu ngày: tổng trả khách, nhận / đã trả / còn lại, doanh thu = offline + online − chiết khấu",
  "Cột hoặc hàng bị ẩn mà vẫn chứa số liệu đang được dùng",
  "AI (tùy chọn): nhận diện tab lạ, giải thích và xếp ưu tiên các phát hiện",
];

const GENERIC_CHECKS = [
  "Dòng trùng lặp, số chứng từ/hóa đơn dùng lặp, nghi thanh toán trùng",
  "Tách nhỏ giao dịch và dồn số tiền sát dưới ngưỡng phê duyệt",
  "Số dư lũy kế bị đứt, dòng “Tổng cộng” không khớp, sai số học trên hóa đơn",
  "Đối chiếu sổ sách ↔ sao kê ↔ hóa đơn, lệch số tiền cùng chứng từ",
  "Sheet/hàng ẩn, siêu dữ liệu nghi chỉnh sửa, ngày tương lai, ngoài kỳ",
  "Benford, giá trị lớn bất thường, Chủ nhật/ngày lễ, từ khóa rủi ro",
  "Mã số thuế và tên đối tác mâu thuẫn, tên gần giống nhau",
  "AI (tùy chọn): nhận xét, thủ tục kiểm tra tiếp theo, câu hỏi cho kế toán",
];

function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}

async function readJson(res: Response): Promise<{ error?: string } & Record<string, unknown>> {
  try {
    return (await res.json()) as { error?: string } & Record<string, unknown>;
  } catch {
    return {};
  }
}

export default function AuditApp() {
  const [items, setItems] = useState<FileItem[]>([]);
  const [form, setForm] = useState<SettingsForm>(DEFAULT_FORM);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ tone: "warn" | "info"; text: string } | null>(null);
  const [rolesDirty, setRolesDirty] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [useAi, setUseAi] = useState(false);
  const [anonymize, setAnonymize] = useState(true);
  const [useAiStructure, setUseAiStructure] = useState(false);
  const [ai, setAi] = useState<AiState>({ state: "idle" });
  const [loadingSample, setLoadingSample] = useState(false);
  /** Đang dùng bộ dữ liệu mẫu (đã tắt chế độ shop). Thêm file thật hoặc xóa hết file mẫu thì phải bật lại chế độ shop. */
  const [sampleActive, setSampleActive] = useState(false);
  const keyCounter = useRef(0);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  /** AI nhận diện bảng lạ chỉ chạy khi đã cấu hình khóa, người dùng bật, và đang ở chế độ shop. */
  const structureOn = useAiStructure && !!aiStatus?.configured && form.shopMode;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai-review", { cache: "no-store" })
      .then((r) => r.json())
      .then((s: AiStatus) => {
        if (!cancelled) setAiStatus(s);
      })
      .catch(() => {
        if (!cancelled) setAiStatus({ configured: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (result) resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [result]);

  /** `sourceOf` cho biết file nào được nhập từ link Google Sheets (trả mã sheet); file như vậy được làm mới khi nhập lại. */
  const isSampleFile = (name: string) => SAMPLES.some((s) => s.name === name);
  /** Quay lại kiểm tiền của shop sau khi dùng dữ liệu mẫu: chỉ trả lại ba mục mà nút “Xem ví dụ” đã đổi, không đụng các cài đặt khác. */
  const leaveSampleMode = () => {
    setSampleActive(false);
    setForm((f) => ({ ...f, periodFrom: DEFAULT_FORM.periodFrom, periodTo: DEFAULT_FORM.periodTo, shopMode: DEFAULT_FORM.shopMode }));
  };
  const addFiles = (files: File[], sourceOf?: (f: File) => string | undefined, fromSample = false) => {
    setNotice(null);
    const leavingSample = !fromSample && sampleActive;
    if (leavingSample) leaveSampleMode();
    const problems: string[] = [];
    const accepted: File[] = [];
    for (const f of files) {
      if (!ALLOWED.includes(extOf(f.name))) problems.push(`“${f.name}”: định dạng chưa hỗ trợ.`);
      else if (f.size > MAX_FILE_BYTES) problems.push(`“${f.name}”: vượt quá 25 MB.`);
      else if (f.size === 0) problems.push(`“${f.name}”: file rỗng.`);
      else accepted.push(f);
    }
    setItems((prev) => {
      const next = leavingSample ? prev.filter((x) => !isSampleFile(x.file.name)) : [...prev];
      for (const f of accepted) {
        const sourceId = sourceOf?.(f);
        const existing = sourceId ? next.findIndex((x) => x.sourceId === sourceId) : -1;
        if (existing >= 0) {
          next[existing] = { ...next[existing], file: f };
          continue;
        }
        if (next.some((x) => x.file.name === f.name && x.file.size === f.size && x.file.lastModified === f.lastModified)) continue;
        if (next.length >= MAX_FILES) {
          problems.push(`Chỉ nhận tối đa ${MAX_FILES} file; “${f.name}” bị bỏ qua.`);
          continue;
        }
        keyCounter.current += 1;
        next.push({ key: `f${keyCounter.current}`, file: f, role: "auto", sourceId });
      }
      return next;
    });
    if (problems.length > 0) setNotice({ tone: "warn", text: problems.join(" ") });
    else if (leavingSample) setNotice({ tone: "info", text: "Đã bỏ 3 file mẫu, bật lại chế độ shop và kỳ kiểm từ 01/01/2026." });
    setResult(null);
    setAi({ state: "idle" });
    setRolesDirty(false);
  };

  const loadSamples = async () => {
    setLoadingSample(true);
    setError("");
    try {
      const files = await Promise.all(
        SAMPLES.map(async (s) => {
          const res = await fetch(`/samples/${s.name}`);
          if (!res.ok) throw new Error(`Không tải được file mẫu ${s.name}`);
          return new File([await res.blob()], s.name, { type: s.type, lastModified: 1_761_900_000_000 });
        }),
      );
      setItems([]);
      keyCounter.current = 0;
      addFiles(files, undefined, true);
      setSampleActive(true);
      // Dữ liệu mẫu là ví dụ chung (không phải của shop): tắt chế độ shop để các luật thống kê chạy và thấy được các bất thường cài sẵn.
      setForm((f) => ({ ...f, periodFrom: "2025-10-01", periodTo: "2025-10-31", shopMode: false }));
      setNotice({
        tone: "info",
        text: "Đã nạp 3 file mẫu (dữ liệu giả lập, không phải của shop: sổ tiền gửi, sao kê ngân hàng, bảng kê hóa đơn tháng 10/2025), đặt kỳ kiểm toán 01/10/2025 - 31/10/2025 và tắt chế độ shop để các luật chung chạy. Dữ liệu được cài sẵn nhiều loại bất thường để bạn xem hệ thống phát hiện thế nào. Bấm “Phân tích” để chạy; muốn quay lại kiểm tiền của shop, chỉ cần thêm file thật của shop (file mẫu sẽ tự được bỏ và chế độ shop tự bật lại), hoặc bấm “Khôi phục mặc định” trong phần Cài đặt.",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được dữ liệu mẫu.");
    } finally {
      setLoadingSample(false);
    }
  };

  const setRole = (key: string, role: RoleSetting) => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, role } : it)));
    if (result) setRolesDirty(true);
  };

  const analyze = async () => {
    if (items.length === 0 || running) return;
    setRunning(true);
    setError("");
    setAi({ state: "idle" });
    setRolesDirty(false);
    try {
      const fd = new FormData();
      for (const it of items) fd.append("files", it.file, it.file.name);
      fd.append("roles", JSON.stringify(items.map((it) => it.role)));
      fd.append("settings", JSON.stringify(formToSettings(form)));
      if (structureOn) fd.append("aiStructure", "1");
      const res = await fetch("/api/analyze", { method: "POST", body: fd });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error ?? `Máy chủ trả lỗi ${res.status}.`);
      const analysis = data as unknown as AnalysisResult;
      setResult(analysis);
      if (useAi && aiStatus?.configured) void runAi(analysis);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không phân tích được. Hãy thử lại.");
    } finally {
      setRunning(false);
    }
  };

  const runAi = async (analysis: AnalysisResult) => {
    setAi({ state: "loading" });
    try {
      const payload = {
        anonymize,
        analysis: {
          files: analysis.files,
          totals: analysis.totals,
          riskScore: analysis.riskScore,
          riskLevel: analysis.riskLevel,
          findings: analysis.findings.slice(0, 40).map((f) => ({ ...f, evidence: f.evidence.slice(0, 8) })),
          benford: analysis.benford.map((b) => ({ fileId: b.fileId, n: b.n, mad: b.mad, chiSquare: b.chiSquare, conformity: b.conformity })),
          reconciliation: analysis.reconciliation,
          digest: analysis.digest,
          shop: analysis.shop
            ? {
                year: analysis.shop.year,
                asOf: analysis.shop.asOf,
                checks: analysis.shop.checks.map((c) => ({ id: c.id, label: c.label, status: c.status, issues: c.issues, amount: c.amount, detail: c.detail })),
                coverage: analysis.shop.coverage.map((c) => ({ level: c.level, label: c.label })),
              }
            : undefined,
        },
      };
      const res = await fetch("/api/ai-review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error ?? `AI trả lỗi ${res.status}.`);
      setAi({ state: "done", review: data as unknown as NonNullable<AiState["review"]> });
    } catch (e) {
      setAi({ state: "error", error: e instanceof Error ? e.message : "AI gặp lỗi không xác định." });
    }
  };

  const busy = running || loadingSample;

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-800">GIVE AWAY PREMIUM · Kiểm tiền năm {SHOP_YEAR}</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">Kiểm tiền ký gửi: đối chiếu bảng lô, sổ thu chi, sao kê và hệ thống</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-700">
          Thêm file Excel hoặc link Google Sheets của shop (bảng lô theo tháng, sổ thu chi, báo cáo tháng, file xuất từ hệ thống) cùng sao kê ngân hàng. Hệ thống tự nhận diện từng bảng, đối chiếu chéo các nguồn và nêu chỗ lệch, thừa, thiếu từ {fmtDate(SHOP_FROM)} đến nay; có thể nhờ AI nhận diện bảng lạ và giải thích kết quả. Kết quả là dấu hiệu cần kiểm tra thêm, không phải kết luận về gian lận. Kiểm hàng chưa có trong phiên bản này.
        </p>
      </header>

      <div className="space-y-6">
        <section aria-labelledby="step-upload">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 id="step-upload" className="text-lg font-semibold text-slate-900">
              1. Tải file cần kiểm tra
            </h2>
            <button type="button" className={buttonSecondary} onClick={loadSamples} disabled={busy}>
              {loadingSample ? <Spinner /> : null}
              Xem ví dụ với dữ liệu mẫu (không phải của shop)
            </button>
          </div>
          <FileDropzone
            items={items}
            onAdd={addFiles}
            onRemove={(key) => {
              const rest = items.filter((it) => it.key !== key);
              setItems(rest);
              if (sampleActive && !rest.some((it) => isSampleFile(it.file.name))) leaveSampleMode();
              setResult(null);
              setAi({ state: "idle" });
            }}
            onRole={setRole}
            disabled={busy}
          />
          <LinkImport
            disabled={busy}
            remaining={Math.max(0, MAX_FILES - items.length)}
            existing={items.map((it) => ({ name: it.file.name, sourceId: it.sourceId }))}
            onImported={(file, sourceId) => addFiles([file], (f) => (f === file ? sourceId : undefined))}
          />
          {notice ? (
            <div className="mt-3">
              <Notice tone={notice.tone}>{notice.text}</Notice>
            </div>
          ) : null}
          <p className="mt-2 text-xs text-slate-600">
            Để đối chiếu chéo, hãy thêm nhiều loại nguồn: bảng lô các tháng, sổ thu chi, báo cáo tháng, file xuất từ hệ thống và sao kê ngân hàng; càng đủ tháng thì càng kiểm được nhiều. File chỉ nằm trong bộ nhớ của lần phân tích này, hệ thống không lưu lại.
          </p>
        </section>

        <section aria-labelledby="step-settings">
          <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <summary className="cursor-pointer rounded-xl px-5 py-3 text-lg font-semibold text-slate-900">
              <span id="step-settings">2. Cài đặt (tùy chọn)</span>
            </summary>
            <div className="border-t border-slate-100 p-5">
              <SettingsPanel
                form={form}
                onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
                disabled={busy}
                aiStatus={aiStatus}
                useAi={useAi}
                onUseAi={setUseAi}
                anonymize={anonymize}
                onAnonymize={setAnonymize}
                useAiStructure={useAiStructure}
                onUseAiStructure={setUseAiStructure}
              />
              <button type="button" className={`${buttonSecondary} mt-4`} onClick={() => {
                  setForm(DEFAULT_FORM);
                  setSampleActive(false);
                }} disabled={busy}>
                Khôi phục mặc định
              </button>
            </div>
          </details>
        </section>

        <section aria-labelledby="step-run" className="flex flex-wrap items-center gap-4">
          <h2 id="step-run" className="sr-only">
            3. Chạy phân tích
          </h2>
          <button type="button" className={`${buttonPrimary} px-6 py-3 text-base`} onClick={analyze} disabled={items.length === 0 || busy}>
            {running ? <Spinner className="h-5 w-5" /> : null}
            {running ? "Đang phân tích…" : result ? "Phân tích lại" : "Phân tích"}
          </button>
          <span className="text-sm text-slate-700" aria-live="polite">
            {items.length === 0 ? "Chọn ít nhất một file để bắt đầu." : `${items.length} file đã chọn.`}
            {structureOn ? " AI sẽ đề xuất cách đọc các tab lạ khi đọc file." : ""}
            {useAi && aiStatus?.configured ? " AI sẽ chạy sau khi có kết quả." : ""}
          </span>
        </section>

        {error ? <Notice tone="error">{error}</Notice> : null}

        <div ref={resultsRef} className="scroll-mt-4">
          {result ? (
            <ResultsView
              result={result}
              ai={ai}
              aiStatus={aiStatus}
              onRunAi={() => void runAi(result)}
              roleSettings={items.map((it) => it.role)}
              onRoleChange={(index, role) => {
                const key = items[index]?.key;
                if (key) setRole(key, role);
              }}
              rolesDirty={rolesDirty}
              onRerun={analyze}
              busy={busy}
            />
          ) : (
            <Card className="p-6 text-sm text-slate-700">
              <h2 className="text-base font-semibold text-slate-900">Hệ thống kiểm tra những gì?</h2>
              <ul className="mt-2 grid gap-x-8 gap-y-1 sm:grid-cols-2">
                {(form.shopMode ? SHOP_CHECKS : GENERIC_CHECKS).map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
