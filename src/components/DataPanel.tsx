"use client";

import { useMemo, useState } from "react";
import { ROLE_LABELS } from "@/lib/audit/catalog";
import type { AnalysisResult, RoleSetting } from "@/lib/types";
import { fmtDate, fmtMoney } from "@/lib/util/stats";
import { normText } from "@/lib/util/text";
import EvidenceTable from "./EvidenceTable";
import { Card, Notice, buttonPrimary, buttonSecondary, inputClass } from "./ui";

interface Props {
  result: AnalysisResult;
  roleSettings: RoleSetting[];
  onRoleChange: (index: number, role: RoleSetting) => void;
  rolesDirty: boolean;
  onRerun: () => void;
  busy: boolean;
}

const PAGE_SIZE = 50;

const KIND_LABEL: Record<string, string> = {
  spreadsheet: "Bảng tính",
  csv: "CSV",
  text: "Văn bản",
  pdf: "PDF",
  word: "Word",
};

export default function DataPanel({ result, roleSettings, onRoleChange, rolesDirty, onRerun, busy }: Props) {
  const [fileFilter, setFileFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = normText(query);
    return result.records.filter((r) => {
      if (fileFilter !== "all" && r.fileId !== fileFilter) return false;
      if (!q) return true;
      const hay = normText(`${r.description ?? ""} ${r.counterparty ?? ""} ${r.reference ?? ""} ${r.id} ${r.date ?? ""}`);
      return hay.includes(q) || String(r.amount).includes(query.replace(/[.,\s]/g, ""));
    });
  }, [result.records, fileFilter, query]);

  const hasShopFiles = result.files.some((f) => f.shopTables?.length);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const rows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return (
    <div className="space-y-4">
      {rolesDirty ? (
        <Notice tone="info">
          <div className="flex flex-wrap items-center gap-3">
            <span>Bạn đã đổi loại file. Bấm “Phân tích lại” để áp dụng.</span>
            <button type="button" className={buttonPrimary} onClick={onRerun} disabled={busy}>
              Phân tích lại
            </button>
          </div>
        </Notice>
      ) : null}

      {hasShopFiles ? (
        <Notice tone="info">
          Các file bảng lô, sổ thu chi, báo cáo tháng và file xuất từ hệ thống được đọc theo từng bảng nghiệp vụ nên không có “dòng giao dịch” như sao kê. Điều đó không có nghĩa là file chưa đọc được: kết quả nằm ở tab “Kiểm tiền” và “Phát hiện”. Bảng ở cuối trang chỉ liệt kê các dòng giao dịch (chủ yếu là sao kê ngân hàng).
        </Notice>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {result.files.map((f, i) => {
          const shopTables = f.shopTables ?? [];
          const isShop = shopTables.length > 0;
          const shopTabs = shopTables.reduce((s, t) => s + t.count, 0);
          const shopRows = shopTables.reduce((s, t) => s + t.rows, 0);
          return (
          <Card key={f.fileId} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-slate-900" title={f.fileName}>
                  <span className="mr-2 rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-semibold text-indigo-800">{f.fileId}</span>
                  {f.fileName}
                </h3>
                <p className="text-xs text-slate-600">
                  {KIND_LABEL[f.kind] ?? f.kind} ·{" "}
                  {isShop
                    ? `bảng của shop: ${shopTabs.toLocaleString("vi-VN")} tab, ${shopRows.toLocaleString("vi-VN")} dòng đã đọc`
                    : `${f.records.toLocaleString("vi-VN")} dòng giao dịch`}
                  {f.rowsSkipped ? ` · bỏ qua ${f.rowsSkipped.toLocaleString("vi-VN")} dòng không phải giao dịch` : ""}
                </p>
              </div>
              {isShop ? null : (
                <div>
                  <label htmlFor={`data-role-${f.fileId}`} className="sr-only">
                    Loại của {f.fileName}
                  </label>
                  <select
                    id={`data-role-${f.fileId}`}
                    value={roleSettings[i] ?? "auto"}
                    onChange={(e) => onRoleChange(i, e.target.value as RoleSetting)}
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900"
                  >
                    <option value="auto">Tự động ({ROLE_LABELS[f.guessedRole]})</option>
                    <option value="ledger">{ROLE_LABELS.ledger}</option>
                    <option value="bank">{ROLE_LABELS.bank}</option>
                    <option value="invoice">{ROLE_LABELS.invoice}</option>
                    <option value="other">{ROLE_LABELS.other}</option>
                  </select>
                </div>
              )}
            </div>
            {isShop ? (
              <div className="mt-3 text-xs text-slate-700">
                <p className="text-slate-600">Đã nhận diện các bảng của shop trong file này:</p>
                <ul className="mt-1 flex flex-wrap gap-1.5" aria-label={`Bảng đã nhận diện trong ${f.fileName}`}>
                  {shopTables.map((t) => (
                    <li key={t.kind} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-slate-800">
                      {t.label}: {t.count} tab{t.hidden > 0 ? ` (${t.hidden} ẩn)` : ""} · {t.rows.toLocaleString("vi-VN")} dòng
                      {t.kind === "gaProducts" ? " (để kiểm hàng sau)" : ""}
                    </li>
                  ))}
                </ul>
                {f.shopUnknownTabs ? <p className="mt-1.5 text-amber-900">{f.shopUnknownTabs} tab chưa nhận diện, không đưa vào kiểm tra.</p> : null}
              </div>
            ) : (
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-700">
                <div>
                  <dt className="text-slate-600">Đang xử lý như</dt>
                  <dd className="font-semibold text-slate-900">{ROLE_LABELS[f.role]}</dd>
                </div>
                <div>
                  <dt className="text-slate-600">Kỳ dữ liệu</dt>
                  <dd className="font-semibold text-slate-900">
                    {f.dateFrom ? `${fmtDate(f.dateFrom)} - ${fmtDate(f.dateTo)}` : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-600">Tổng Nợ / Ghi nợ</dt>
                  <dd className="font-semibold tabular-nums text-slate-900">{fmtMoney(f.totalDebit)}</dd>
                </div>
                <div>
                  <dt className="text-slate-600">Tổng Có / Ghi có</dt>
                  <dd className="font-semibold tabular-nums text-slate-900">{fmtMoney(f.totalCredit)}</dd>
                </div>
              </dl>
            )}
            {f.error ? (
              <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">
                {f.error}
              </p>
            ) : null}
            {f.warnings.length > 0 ? (
              <ul className="mt-3 list-disc space-y-1 rounded-lg bg-amber-50 py-2 pl-7 pr-3 text-xs text-amber-900">
                {f.warnings.map((w, k) => (
                  <li key={k}>{w}</li>
                ))}
              </ul>
            ) : null}
          </Card>
          );
        })}
      </div>

      <Card className="p-4">
        <h3 className="text-base font-semibold text-slate-900">Dòng dữ liệu đã chuẩn hóa</h3>
        <p className="mt-1 text-xs text-slate-600">
          Đây là cách hệ thống đã đọc file của bạn. Hãy lướt qua để chắc chắn cột ngày, số tiền, Nợ/Có được nhận đúng trước khi tin vào kết quả.
          {result.recordsTruncated ? " Chỉ hiển thị phần đầu của mỗi file; các luật vẫn chạy trên toàn bộ dữ liệu." : ""}
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="data-file" className="block text-xs font-medium text-slate-700">
              File
            </label>
            <select
              id="data-file"
              value={fileFilter}
              onChange={(e) => {
                setFileFilter(e.target.value);
                setPage(0);
              }}
              className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900"
            >
              <option value="all">Tất cả file</option>
              {result.files.map((f) => (
                <option key={f.fileId} value={f.fileId}>
                  {f.fileId} · {f.fileName}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-60 flex-1">
            <label htmlFor="data-search" className="block text-xs font-medium text-slate-700">
              Tìm theo diễn giải, đối tượng, số chứng từ, số tiền
            </label>
            <input
              id="data-search"
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              className={inputClass}
              placeholder="Ví dụ: Thiên Phú, UNC0045, 38500000"
            />
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-800" aria-live="polite">
            <span>
              {filtered.length.toLocaleString("vi-VN")} dòng · trang {safePage + 1}/{pages}
            </span>
            <button type="button" className={buttonSecondary} disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
              Trước
            </button>
            <button type="button" className={buttonSecondary} disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)}>
              Sau
            </button>
          </div>
        </div>
        <div className="mt-3">
          {rows.length > 0 ? (
            <EvidenceTable rows={rows} caption="Các dòng giao dịch đã chuẩn hóa" />
          ) : (
            <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-700">Không có dòng nào khớp bộ lọc.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
