// Điểm vào của lớp kiểm tiền shop: gộp dữ liệu, chạy từng nhóm phép kiểm, trả bản nháp phát hiện và bảng tóm tắt cho giao diện.

import type { FindingDraft } from "@/lib/audit/shared";
import type { AuditRecord, ParsedFile } from "@/lib/types";
import { SHOP } from "../config";
import { KIND_LABELS, type ShopFileData, type ShopSourceSummary, type ShopSummary, type ShopTabGroup, type ShopTableKind } from "../types";
import { buildBook } from "./book";
import { Ev, type ModuleOut, type Shared, emptyOut, mergeInto } from "./helpers";
import { bankChecks } from "./bank";
import { ledgerChecks } from "./ledger";
import { lotChecks } from "./lots";
import { reportChecks } from "./report";
import { systemChecks } from "./system";

export interface ShopAuditInput {
  files: ParsedFile[];
  /** Bản ghi giao dịch chung (đã gán vai trò): dùng sao kê ngân hàng. */
  records: AuditRecord[];
  /** Ngày hiện tại YYYY-MM-DD. */
  today: string;
}

export interface ShopAuditOutput {
  drafts: FindingDraft[];
  summary: ShopSummary;
}

/** Gộp các tab đã nhận diện của một file theo loại bảng (số tab, số tab ẩn, số dòng). */
export function summarizeTabs(s: ShopFileData): ShopTabGroup[] {
  const kinds = new Map<ShopTableKind, { count: number; hidden: number; rows: number }>();
  for (const t of s.tabs) {
    const e = kinds.get(t.kind) ?? { count: 0, hidden: 0, rows: 0 };
    e.count++;
    if (t.hidden) e.hidden++;
    e.rows += t.rows;
    kinds.set(t.kind, e);
  }
  return [...kinds.entries()].map(([kind, v]) => ({ kind, label: KIND_LABELS[kind], ...v }));
}

function sourcesOf(files: ParsedFile[]): ShopSourceSummary[] {
  const out: ShopSourceSummary[] = [];
  for (const f of files) {
    const s = f.shop;
    if (!s) continue;
    out.push({
      fileId: f.fileId,
      fileName: f.fileName,
      tabs: summarizeTabs(s),
      unknownTabs: s.unknown.map((u) => ({
        sheet: u.sheet,
        hidden: u.hidden,
        rows: u.rows,
        headers: u.columns.map((c) => c.header).filter(Boolean).slice(0, 8),
      })),
    });
  }
  return out;
}

/**
 * Sổ shop cất các tab của tháng cũ ở chế độ ẩn như một thói quen lưu trữ, nên tab ẩn không bị coi là lỗi.
 * Cái đáng xem là cột/hàng ẩn mà bộ trích xuất đang dùng để lấy số (ví dụ cột "Doanh thu" bị ẩn khỏi báo cáo tháng).
 */
function hiddenChecks(b: ReturnType<typeof buildBook>, sh: Shared): ModuleOut {
  const out = emptyOut();
  const flagged = b.tabs.filter((t) => (t.tab.hiddenCols?.length ?? 0) > 0 || (t.tab.hiddenRows?.length ?? 0) > 0);
  const hiddenTabs = b.tabs.filter((t) => t.tab.hidden).length;
  if (hiddenTabs > 0) {
    out.coverage.push({
      kind: "tab",
      level: "info",
      label: `${hiddenTabs}/${b.tabs.length} tab nghiệp vụ đang bị ẩn`,
      detail: "Sổ cất các tháng cũ ở chế độ ẩn như kho lưu trữ nên không tính là lỗi; vẫn được đọc và kiểm đầy đủ.",
    });
  }
  if (flagged.length === 0) return out;
  const rows = flagged.map((t) =>
    sh.ev.row({ fileId: t.fileId, fileName: t.fileName, sheet: t.tab.sheet }, 1, {
      description: `Tab "${t.tab.sheet}" (${KIND_LABELS[t.tab.kind]}): ${t.tab.hiddenCols?.length ? `cột ẩn có dữ liệu ${t.tab.hiddenCols.join(", ")}` : ""}${t.tab.hiddenCols?.length && t.tab.hiddenRows?.length ? "; " : ""}${t.tab.hiddenRows?.length ? `${t.tab.hiddenRows.length} hàng ẩn có dữ liệu (hàng ${t.tab.hiddenRows.slice(0, 8).join(", ")}${t.tab.hiddenRows.length > 8 ? "…" : ""})` : ""}`,
      amount: 0,
    }),
  );
  out.drafts.push({
    rule: "hidden_content",
    severity: "medium",
    title: `Cột hoặc hàng bị ẩn đang chứa số liệu: ${flagged.length} tab`,
    description:
      `${flagged.length} tab có cột hoặc hàng bị ẩn nhưng vẫn chứa dữ liệu mà lớp kiểm đang dùng (ví dụ cột "Doanh thu" của báo cáo tháng). ` +
      `Người đọc báo cáo sẽ không thấy các số này. Các dòng ẩn vẫn được đưa vào kiểm tra.`,
    recommendation: "Bỏ ẩn và xem nội dung; hỏi người lập vì sao ẩn.",
    records: [],
    evidenceOverride: rows,
    total: rows.length,
    amount: 0,
  });
  return out;
}

export function shopAudit(input: ShopAuditInput): ShopAuditOutput {
  const book = buildBook(input.files, input.records, input.today);
  const sh: Shared = { ev: new Ev(), dupKeys: new Set() };
  const out: ModuleOut = emptyOut();

  const run = (name: string, fn: () => ModuleOut): void => {
    try {
      mergeInto(out, fn());
    } catch (e) {
      out.drafts.push({
        rule: "rule_error",
        severity: "info",
        title: `Phép kiểm tiền "${name}" gặp lỗi và bị bỏ qua`,
        description: e instanceof Error ? e.message : String(e),
        records: [],
        amount: 0,
      });
    }
  };

  run("Lô ký gửi và chuyển khoản", () => lotChecks(book, sh));
  run("Hệ thống quản lý ký gửi", () => systemChecks(book, sh));
  run("Sổ thu chi", () => ledgerChecks(book, sh));
  run("Sao kê ngân hàng", () => bankChecks(book, sh));
  run("Báo cáo tháng và doanh thu", () => reportChecks(book, sh));
  run("Cột và hàng bị ẩn", () => hiddenChecks(book, sh));

  return {
    drafts: out.drafts,
    summary: {
      year: SHOP.year,
      from: SHOP.from,
      asOf: book.asOf,
      sources: sourcesOf(input.files),
      figures: out.figures,
      checks: out.checks,
      coverage: out.coverage,
    },
  };
}
