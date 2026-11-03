"use client";

import type { ReactNode } from "react";
import { SEVERITY_LABELS } from "@/lib/audit/catalog";
import type { Severity } from "@/lib/types";

const SEVERITY_STYLE: Record<Severity, { box: string; icon: string }> = {
  high: { box: "bg-red-100 text-red-800 ring-red-300", icon: "▲" },
  medium: { box: "bg-amber-100 text-amber-900 ring-amber-300", icon: "◆" },
  low: { box: "bg-sky-100 text-sky-900 ring-sky-300", icon: "●" },
  info: { box: "bg-slate-100 text-slate-700 ring-slate-300", icon: "○" },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const s = SEVERITY_STYLE[severity];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${s.box}`}>
      <span aria-hidden="true">{s.icon}</span>
      {SEVERITY_LABELS[severity]}
    </span>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`${className} motion-safe:animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</section>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs font-medium text-slate-600">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-slate-600">{hint}</div> : null}
    </div>
  );
}

export function Notice({ tone, children }: { tone: "error" | "warn" | "info"; children: ReactNode }) {
  const style = {
    error: "border-red-300 bg-red-50 text-red-900",
    warn: "border-amber-300 bg-amber-50 text-amber-900",
    info: "border-sky-300 bg-sky-50 text-sky-900",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${style}`}>
      {children}
    </div>
  );
}

export const buttonPrimary =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600";

export const buttonSecondary =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";

export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:border-indigo-500";
