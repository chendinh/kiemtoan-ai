"use client";

import { useState } from "react";
import { ROLE_LABELS } from "@/lib/audit/catalog";
import type { RoleSetting } from "@/lib/types";
import { buttonSecondary } from "./ui";

export interface FileItem {
  key: string;
  file: File;
  role: RoleSetting;
  /** Mã Google Sheet nếu file được nhập từ link: nhập lại cùng sheet thì làm mới file này thay vì thêm bản trùng. */
  sourceId?: string;
}

/** Số file tối đa mỗi lần phân tích (khớp với giới hạn của máy chủ). Một năm của shop gồm khoảng 20 file. */
export const MAX_FILES = 40;

interface Props {
  items: FileItem[];
  onAdd: (files: File[]) => void;
  onRemove: (key: string) => void;
  onRole: (key: string, role: RoleSetting) => void;
  disabled?: boolean;
}

const ACCEPT = ".xlsx,.xlsm,.xlsb,.xls,.ods,.csv,.txt,.tsv,.pdf,.docx,.doc";

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function extBadge(name: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name);
  return (m ? m[1] : "?").toUpperCase().slice(0, 4);
}

export default function FileDropzone({ items, onAdd, onRemove, onRole, disabled }: Props) {
  const [dragging, setDragging] = useState(false);

  return (
    <div>
      <label
        htmlFor="file-input"
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) onAdd(Array.from(e.dataTransfer.files));
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors focus-within:ring-2 focus-within:ring-indigo-600 focus-within:ring-offset-2 ${
          dragging ? "border-indigo-500 bg-indigo-50" : "border-slate-300 bg-white hover:border-slate-400"
        } ${disabled ? "pointer-events-none opacity-60" : ""}`}
      >
        <input
          id="file-input"
          type="file"
          multiple
          accept={ACCEPT}
          disabled={disabled}
          className="sr-only"
          onChange={(e) => {
            onAdd(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <svg className="h-8 w-8 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" strokeLinecap="round" />
        </svg>
        <span className="text-sm font-semibold text-slate-900">Kéo thả file vào đây hoặc bấm để chọn</span>
        <span className="text-xs text-slate-600">
          Excel (.xlsx, .xls), CSV, TXT, PDF có chữ, Word (.docx, .doc). Tối đa {MAX_FILES} file, mỗi file không quá 25 MB.
        </span>
      </label>

      {items.length > 0 ? (
        <ul className="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white" aria-label="Danh sách file đã chọn">
          {items.map((it, i) => (
            <li key={it.key} className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[auto_1fr_auto_auto]">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-[10px] font-bold text-slate-700"
              >
                {extBadge(it.file.name)}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-900" title={it.file.name}>
                  <span className="mr-1.5 rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-semibold text-indigo-800">F{i + 1}</span>
                  {it.file.name}
                </div>
                <div className="text-xs text-slate-600">{sizeLabel(it.file.size)}</div>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="sr-only" htmlFor={`role-${it.key}`}>
                  Loại của {it.file.name}
                </label>
                <select
                  id={`role-${it.key}`}
                  value={it.role}
                  disabled={disabled}
                  onChange={(e) => onRole(it.key, e.target.value as RoleSetting)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 sm:w-52"
                >
                  <option value="auto">Tự động nhận diện loại</option>
                  <option value="ledger">{ROLE_LABELS.ledger}</option>
                  <option value="bank">{ROLE_LABELS.bank}</option>
                  <option value="invoice">{ROLE_LABELS.invoice}</option>
                  <option value="other">{ROLE_LABELS.other}</option>
                </select>
              </div>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRemove(it.key)}
                className={`${buttonSecondary} col-start-2 justify-self-start sm:col-start-auto`}
                aria-label={`Bỏ file ${it.file.name}`}
              >
                Bỏ
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
