"use client";

import { useMemo, useRef, useState } from "react";
import { CATEGORY_LABELS, RULE_CATALOG, SEVERITY_LABELS, SEVERITY_ORDER } from "@/lib/audit/catalog";
import { buildRecordLookup } from "@/lib/client/evidence";
import { exportReport } from "@/lib/client/export";
import type { AiFindingReview, AnalysisResult, AiStatus, RiskLevel, RoleSetting, RuleCategory, RuleId, Severity } from "@/lib/types";
import { fmtDate } from "@/lib/util/stats";
import { normText } from "@/lib/util/text";
import AiPanel, { type AiState } from "./AiPanel";
import BenfordPanel from "./BenfordPanel";
import DataPanel from "./DataPanel";
import FindingCard from "./FindingCard";
import ReconciliationPanel from "./ReconciliationPanel";
import ShopPanel from "./ShopPanel";
import { Card, Notice, Spinner, buttonPrimary, buttonSecondary, inputClass } from "./ui";

type TabId = "shop" | "findings" | "recon" | "benford" | "data" | "ai";

interface Props {
  result: AnalysisResult;
  ai: AiState;
  aiStatus: AiStatus | null;
  onRunAi: () => void;
  roleSettings: RoleSetting[];
  onRoleChange: (index: number, role: RoleSetting) => void;
  rolesDirty: boolean;
  onRerun: () => void;
  busy: boolean;
}

const RISK: Record<RiskLevel, { label: string; bar: string; text: string }> = {
  low: { label: "Thấp", bar: "bg-emerald-600", text: "text-emerald-800" },
  medium: { label: "Trung bình", bar: "bg-amber-500", text: "text-amber-900" },
  high: { label: "Cao", bar: "bg-orange-600", text: "text-orange-900" },
  critical: { label: "Rất cao", bar: "bg-red-600", text: "text-red-800" },
};

const SEV_TILE: Record<Severity, string> = {
  high: "border-red-300 bg-red-50 text-red-900",
  medium: "border-amber-300 bg-amber-50 text-amber-900",
  low: "border-sky-300 bg-sky-50 text-sky-900",
  info: "border-slate-300 bg-slate-50 text-slate-800",
};

export default function ResultsView({ result, ai, aiStatus, onRunAi, roleSettings, onRoleChange, rolesDirty, onRerun, busy }: Props) {
  const [tab, setTab] = useState<TabId>(() => (result.shop ? "shop" : "findings"));
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [sev, setSev] = useState<Record<Severity, boolean>>({ high: true, medium: true, low: true, info: true });
  const [cat, setCat] = useState<"all" | RuleCategory>("all");
  const [ruleFilter, setRuleFilter] = useState<{ rules: RuleId[]; label: string } | null>(null);
  const [query, setQuery] = useState("");
  const [hideReviewed, setHideReviewed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const lookup = useMemo(() => buildRecordLookup(result), [result]);
  const aiReviews = useMemo(() => {
    const m = new Map<string, AiFindingReview>();
    for (const r of ai.review?.findingReviews ?? []) m.set(r.findingId, r);
    return m;
  }, [ai.review]);

  const filtered = useMemo(() => {
    const q = normText(query);
    return result.findings.filter((f) => {
      if (!sev[f.severity]) return false;
      if (ruleFilter && !ruleFilter.rules.includes(f.rule)) return false;
      if (cat !== "all" && RULE_CATALOG[f.rule].category !== cat) return false;
      if (hideReviewed && reviewed.has(f.id)) return false;
      if (!q) return true;
      return normText(`${f.id} ${f.title} ${f.description} ${RULE_CATALOG[f.rule].label}`).includes(q);
    });
  }, [result.findings, sev, cat, ruleFilter, query, hideReviewed, reviewed]);

  // Chế độ shop tắt Benford; khi không có kết quả Benford nào thì ẩn tab cho khỏi rối.
  const showBenford = result.benford.length > 0 || result.benfordSkipped.length > 0 || result.settings.shopMode === false;
  const tabs: { id: TabId; label: string }[] = [
    ...(result.shop ? [{ id: "shop" as const, label: `Kiểm tiền ${result.shop.year}` }] : []),
    { id: "findings", label: `Phát hiện (${result.findings.length})` },
    { id: "recon", label: `Đối chiếu${result.reconciliation.length ? ` (${result.reconciliation.length})` : ""}` },
    ...(showBenford ? [{ id: "benford" as const, label: "Benford" }] : []),
    { id: "data", label: "Dữ liệu đã đọc" },
    { id: "ai", label: "AI" },
  ];
  // Lần phân tích lại có thể làm tab đang mở biến mất (ví dụ tắt chế độ shop): rơi về "Phát hiện".
  const activeTab: TabId = tabs.some((t) => t.id === tab) ? tab : "findings";

  const goTo = (id: TabId) => setTab(id);

  const resetFindingFilters = () => {
    setSev({ high: true, medium: true, low: true, info: true });
    setCat("all");
    setRuleFilter(null);
    setQuery("");
    setHideReviewed(false);
  };

  const openFinding = (id: string) => {
    setTab("findings");
    resetFindingFilters();
    window.setTimeout(() => {
      document.getElementById(`finding-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  };

  /** Từ ma trận kiểm tiền: chuyển sang danh sách phát hiện, chỉ giữ các phát hiện thuộc những luật của phép kiểm đó. */
  const openRules = (rules: RuleId[], label: string) => {
    setTab("findings");
    resetFindingFilters();
    setRuleFilter({ rules, label });
    window.setTimeout(() => {
      document.getElementById("tab-findings")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  };

  const onTabKey = (e: React.KeyboardEvent, idx: number) => {
    let next = idx;
    if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    goTo(tabs[next].id);
    tabRefs.current[next]?.focus();
  };

  const doExport = async () => {
    setExporting(true);
    setExportError("");
    try {
      await exportReport(result, reviewed, ai.review ?? null, lookup);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Không xuất được file Excel.");
    } finally {
      setExporting(false);
    }
  };

  const risk = RISK[result.riskLevel];
  // File đã nhận diện được bảng nghiệp vụ của shop thì không phải file lỗi dù không có dòng giao dịch kiểu sao kê.
  const brokenFiles = result.files.filter((f) => f.error || (f.records === 0 && !f.shopTables?.length));
  const onlySeverity = (s: Severity) => {
    setSev({ high: false, medium: false, low: false, info: false, [s]: true });
    setRuleFilter(null);
    setTab("findings");
  };

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-60">
            <h2 className="text-lg font-semibold text-slate-900">Kết quả phân tích</h2>
            <p className="text-xs text-slate-600">
              {result.files.length} file · {result.totals.records.toLocaleString("vi-VN")} dòng giao dịch
              {result.totals.dateFrom ? ` · ${fmtDate(result.totals.dateFrom)} - ${fmtDate(result.totals.dateTo)}` : ""}
            </p>
            <div className="mt-3 flex items-end gap-3">
              <span className={`text-4xl font-bold tabular-nums ${risk.text}`}>{result.riskScore}</span>
              <span className="pb-1 text-sm text-slate-700">
                / 100 · Rủi ro <strong className={risk.text}>{risk.label}</strong>
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={result.riskScore}
              aria-label={`Điểm rủi ro ${result.riskScore} trên 100, mức ${risk.label}`}
              className="mt-2 h-2.5 w-64 max-w-full overflow-hidden rounded-full bg-slate-200"
            >
              <div className={`h-full ${risk.bar}`} style={{ width: `${result.riskScore}%` }} />
            </div>
            <p className="mt-2 max-w-md text-xs text-slate-600">
              Điểm tham khảo, tổng hợp từ số lượng và mức độ các phát hiện. Phát hiện là dấu hiệu cần kiểm tra thêm, không phải kết luận về gian lận.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Số phát hiện theo mức độ (bấm để lọc)">
            {SEVERITY_ORDER.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onlySeverity(s)}
                className={`rounded-lg border px-4 py-2 text-left ${SEV_TILE[s]} hover:brightness-95`}
              >
                <span className="block text-xs font-medium">{SEVERITY_LABELS[s]}</span>
                <span className="block text-2xl font-bold tabular-nums">{result.severityCounts[s]}</span>
                <span className="sr-only"> phát hiện, bấm để chỉ xem mức này</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
          <button type="button" className={buttonPrimary} onClick={doExport} disabled={exporting}>
            {exporting ? <Spinner /> : null}
            Xuất báo cáo Excel
          </button>
          <span className="text-xs text-slate-600">
            Đã xem xét {reviewed.size}/{result.findings.length} phát hiện
          </span>
        </div>
        {exportError ? (
          <div className="mt-3">
            <Notice tone="error">{exportError}</Notice>
          </div>
        ) : null}
      </Card>

      {brokenFiles.length > 0 ? (
        <Notice tone="warn">
          <p className="font-semibold">Có file chưa đọc được dữ liệu giao dịch:</p>
          <ul className="mt-1 list-disc pl-5">
            {brokenFiles.map((f) => (
              <li key={f.fileId}>
                <strong>{f.fileName}</strong>: {f.error ?? "không nhận diện được bảng giao dịch (cần có cột ngày và số tiền / Nợ-Có)."}
              </li>
            ))}
          </ul>
          <button type="button" className="mt-2 text-sm font-medium underline" onClick={() => goTo("data")}>
            Xem chi tiết ở tab “Dữ liệu đã đọc”
          </button>
        </Notice>
      ) : null}

      <div>
        <div role="tablist" aria-label="Các phần của kết quả" className="flex flex-wrap gap-1 border-b border-slate-200">
          {tabs.map((t, i) => {
            const selected = activeTab === t.id;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                role="tab"
                type="button"
                id={`tab-${t.id}`}
                aria-selected={selected}
                aria-controls={`panel-${t.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => goTo(t.id)}
                onKeyDown={(e) => onTabKey(e, i)}
                className={`-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium ${
                  selected ? "border-indigo-600 bg-white text-indigo-800" : "border-transparent text-slate-700 hover:bg-slate-100"
                }`}
              >
                {t.label}
                {t.id === "ai" && ai.state === "loading" ? <Spinner className="ml-2 inline h-3.5 w-3.5" /> : null}
              </button>
            );
          })}
        </div>

        <div role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`} tabIndex={0} className="pt-4">
          {activeTab === "shop" ? <ShopPanel result={result} onOpenRules={openRules} /> : null}

          {activeTab === "findings" ? (
            <div className="space-y-4">
              {ruleFilter ? (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm text-indigo-950">
                  <span>
                    Đang lọc: phát hiện cùng loại với phép kiểm <strong>“{ruleFilter.label}”</strong>
                  </span>
                  <button type="button" className="font-medium underline" onClick={() => setRuleFilter(null)}>
                    Bỏ lọc
                  </button>
                </div>
              ) : null}
              <div className="flex flex-wrap items-end gap-3">
                <fieldset className="flex flex-wrap items-center gap-2">
                  <legend className="sr-only">Lọc theo mức độ</legend>
                  {SEVERITY_ORDER.map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={sev[s]}
                      onClick={() => setSev((prev) => ({ ...prev, [s]: !prev[s] }))}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                        sev[s] ? SEV_TILE[s] : "border-slate-300 bg-white text-slate-600 line-through"
                      }`}
                    >
                      {SEVERITY_LABELS[s]} ({result.severityCounts[s]})
                    </button>
                  ))}
                </fieldset>
                <div>
                  <label htmlFor="f-cat" className="block text-xs font-medium text-slate-700">
                    Nhóm
                  </label>
                  <select
                    id="f-cat"
                    value={cat}
                    onChange={(e) => setCat(e.target.value as "all" | RuleCategory)}
                    className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900"
                  >
                    <option value="all">Tất cả nhóm</option>
                    {(Object.keys(CATEGORY_LABELS) as RuleCategory[]).map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-52 flex-1">
                  <label htmlFor="f-q" className="block text-xs font-medium text-slate-700">
                    Tìm trong phát hiện
                  </label>
                  <input id="f-q" type="search" value={query} onChange={(e) => setQuery(e.target.value)} className={inputClass} placeholder="Ví dụ: hóa đơn, Thiên Phú, số dư" />
                </div>
                <label className="flex items-center gap-2 pb-2 text-sm text-slate-800">
                  <input type="checkbox" checked={hideReviewed} onChange={(e) => setHideReviewed(e.target.checked)} className="h-4 w-4 rounded border-slate-400 text-indigo-600" />
                  Ẩn phát hiện đã xem xét
                </label>
              </div>

              <p className="text-sm text-slate-700" aria-live="polite">
                Hiển thị {filtered.length}/{result.findings.length} phát hiện, xếp theo mức độ rồi theo số tiền.
              </p>

              {filtered.length === 0 ? (
                <Card className="p-6 text-center text-sm text-slate-700">
                  {result.findings.length === 0
                    ? "Không có phát hiện nào từ các luật đã chạy. Điều này không có nghĩa dữ liệu hoàn toàn sạch: kiểm tra tab “Dữ liệu đã đọc” để chắc chắn file được đọc đúng."
                    : "Không có phát hiện nào khớp bộ lọc."}
                </Card>
              ) : null}

              {filtered.map((f) => (
                <FindingCard
                  key={f.id}
                  finding={f}
                  lookup={lookup}
                  reviewed={reviewed.has(f.id)}
                  aiReview={aiReviews.get(f.id)}
                  onToggleReviewed={() =>
                    setReviewed((prev) => {
                      const next = new Set(prev);
                      if (next.has(f.id)) next.delete(f.id);
                      else next.add(f.id);
                      return next;
                    })
                  }
                />
              ))}
            </div>
          ) : null}

          {activeTab === "recon" ? <ReconciliationPanel summaries={result.reconciliation} findings={result.findings} onOpenFinding={openFinding} /> : null}
          {activeTab === "benford" ? <BenfordPanel results={result.benford} skipped={result.benfordSkipped} /> : null}
          {activeTab === "data" ? (
            <DataPanel result={result} roleSettings={roleSettings} onRoleChange={onRoleChange} rolesDirty={rolesDirty} onRerun={onRerun} busy={busy} />
          ) : null}
          {activeTab === "ai" ? <AiPanel status={aiStatus} ai={ai} onRun={onRunAi} lookup={lookup} onOpenFinding={openFinding} /> : null}
        </div>
      </div>

      <div className="flex justify-end">
        <button type="button" className={buttonSecondary} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          Lên đầu trang
        </button>
      </div>
    </div>
  );
}
