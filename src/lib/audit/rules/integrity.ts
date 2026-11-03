// Toàn vẹn tài liệu: nội dung ẩn, siêu dữ liệu nghi chỉnh sửa, sai số học trên dòng chứng từ.

import type { AuditRecord, DocMetadata, Severity } from "@/lib/types";
import { fmtMoney, fmtPct } from "@/lib/util/stats";
import { type FindingDraft, type RuleContext, sortByAmountDesc } from "../shared";

const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1, info: 0 };
const maxSeverity = (a: Severity, b: Severity): Severity => (SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b);

// ---------------------------------------------------------------- nội dung ẩn

export function hiddenContentRule(ctx: RuleContext): FindingDraft[] {
  const out: FindingDraft[] = [];
  for (const f of ctx.files) {
    const h = f.hidden;
    if (h.sheets.length === 0 && h.rows.length === 0 && h.columns.length === 0) continue;

    const parts: string[] = [];
    const evidence: AuditRecord[] = [];
    const notes = new Map<string, string>();
    let severity: Severity = "low";

    for (const s of h.sheets) {
      const recs = ctx.records.filter((r) => r.fileId === f.fileId && r.sheet === s.name);
      const kind = s.state === "veryHidden" ? "ẩn sâu (chỉ mở được bằng VBA)" : "bị ẩn";
      parts.push(`Sheet "${s.name}" ${kind}${s.hasData ? `, có dữ liệu${recs.length ? ` (${recs.length} dòng giao dịch)` : ""}` : ""}`);
      if (s.hasData) severity = maxSeverity(severity, s.state === "veryHidden" ? "high" : "medium");
      for (const r of recs) {
        evidence.push(r);
        notes.set(r.id, `Nằm trong sheet ${s.state === "veryHidden" ? "ẩn sâu" : "ẩn"} "${s.name}"`);
      }
    }
    for (const row of h.rows) {
      const set = new Set(row.rows);
      const recs = ctx.records.filter((r) => r.fileId === f.fileId && r.sheet === row.sheet && set.has(r.row));
      const shown = row.rows.slice(0, 10).join(", ") + (row.rows.length > 10 ? "…" : "");
      parts.push(`Sheet "${row.sheet}" có ${row.rows.length} hàng ẩn chứa dữ liệu (hàng ${shown})`);
      severity = maxSeverity(severity, recs.length > 0 ? "medium" : "low");
      for (const r of recs) {
        evidence.push(r);
        notes.set(r.id, "Nằm trong hàng bị ẩn");
      }
    }
    for (const col of h.columns) {
      parts.push(`Sheet "${col.sheet}" có cột ẩn chứa dữ liệu: ${col.columns.join(", ")}`);
    }

    out.push({
      rule: "hidden_content",
      severity,
      title: "File chứa nội dung bị ẩn",
      description: `File ${f.fileName}: ${parts.join("; ")}.`,
      recommendation: "Bỏ ẩn toàn bộ sheet/hàng/cột và xem nội dung; hỏi người lập vì sao ẩn. Các dòng ẩn vẫn được hệ thống đưa vào phân tích.",
      records: sortByAmountDesc(evidence),
      notes,
    });
  }
  return out;
}

// ---------------------------------------------------------------- siêu dữ liệu tài liệu

const EDITOR_RE = /(acrobat(?! distiller)|foxit|phantompdf|nitro|pdfescape|sejda|ilovepdf|smallpdf|pdf-?xchange|pdfelement|wondershare|pdf24|sodapdf|soda pdf|master ?pdf|pdfill)/i;
const PRINT_RE = /(microsoft.{0,12}(word|excel|powerpoint)|libreoffice|openoffice|skia\/pdf|quartz pdfcontext|chrome|chromium|print to pdf|wps|canva)/i;

function daysBetween(a: string, b: string): number | null {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.round((tb - ta) / 86_400_000);
}

function describeMeta(m: DocMetadata): string {
  const bits: string[] = [];
  if (m.creator) bits.push(`creator: ${m.creator}`);
  if (m.producer) bits.push(`producer: ${m.producer}`);
  if (m.application) bits.push(`ứng dụng: ${m.application}`);
  if (m.author) bits.push(`tác giả: ${m.author}`);
  if (m.lastAuthor) bits.push(`người sửa cuối: ${m.lastAuthor}`);
  if (m.created) bits.push(`tạo: ${m.created.slice(0, 16).replace("T", " ")}`);
  if (m.modified) bits.push(`sửa: ${m.modified.slice(0, 16).replace("T", " ")}`);
  return bits.join(" · ");
}

export function metadataRule(ctx: RuleContext): FindingDraft[] {
  const out: FindingDraft[] = [];
  for (const f of ctx.files) {
    const role = ctx.fileRoles.get(f.fileId) ?? f.guessedRole;
    if (role === "other") continue;
    const m = f.metadata;
    const reasons: string[] = [];
    let severity: Severity = "low";

    if (f.kind === "pdf") {
      const tool = `${m.creator ?? ""} ${m.producer ?? ""}`;
      if (EDITOR_RE.test(tool)) {
        reasons.push("được tạo hoặc lưu bằng phần mềm chỉnh sửa PDF");
        severity = maxSeverity(severity, "medium");
      } else if (PRINT_RE.test(tool) && (role === "bank" || role === "invoice")) {
        reasons.push("được xuất bằng phần mềm văn phòng/trình duyệt (in ra PDF), không phải hệ thống phát hành sao kê/hóa đơn");
      }
      if (m.created && m.modified) {
        const d = daysBetween(m.created, m.modified);
        if (d !== null && d >= 1) {
          reasons.push(`ngày sửa muộn hơn ngày tạo ${d} ngày`);
          severity = maxSeverity(severity, "medium");
        }
      }
    } else if ((f.kind === "spreadsheet" || f.kind === "word") && (role === "bank" || role === "invoice")) {
      if (m.author && m.lastAuthor && m.author.trim().toLowerCase() !== m.lastAuthor.trim().toLowerCase()) {
        reasons.push(`người sửa cuối (${m.lastAuthor}) khác người tạo (${m.author})`);
      }
      if (m.created && m.modified) {
        const d = daysBetween(m.created, m.modified);
        if (d !== null && d >= 1) reasons.push(`ngày sửa muộn hơn ngày tạo ${d} ngày`);
      }
    }
    if (reasons.length === 0) continue;

    out.push({
      rule: "document_metadata",
      severity,
      title: "Tài liệu có dấu hiệu bị chỉnh sửa",
      description: `File ${f.fileName} (${role === "bank" ? "sao kê ngân hàng" : role === "invoice" ? "hóa đơn" : "sổ sách"}): ${reasons.join("; ")}. Siêu dữ liệu: ${describeMeta(m)}. Đây chỉ là chỉ báo, không phải bằng chứng.`,
      recommendation: "Lấy bản gốc trực tiếp từ ngân hàng/nhà cung cấp (hoặc xác nhận độc lập) rồi so với file được cung cấp.",
      records: [],
      amount: 0,
    });
  }
  return out;
}

// ---------------------------------------------------------------- sai số học trên dòng

const COMMON_VAT = [0, 0.05, 0.08, 0.1];

export function rowArithmeticRule(ctx: RuleContext): FindingDraft[] {
  const out: FindingDraft[] = [];

  const arithmetic = ctx.records.filter(
    (r) => r.calcDiff !== undefined && Math.abs(r.calcDiff) > Math.max(1, r.amount * 0.0005),
  );
  if (arithmetic.length > 0) {
    const notes = new Map(
      arithmetic.map((r) => [
        r.id,
        `Tiền hàng ${fmtMoney(r.net ?? 0)} + thuế ${fmtMoney(r.tax ?? 0)} = ${fmtMoney((r.net ?? 0) + (r.tax ?? 0))}, nhưng tổng ghi ${fmtMoney(r.amount)} (lệch ${fmtMoney(r.calcDiff as number)})`,
      ] as const),
    );
    out.push({
      rule: "row_arithmetic",
      severity: "high",
      title: "Tiền hàng + thuế không bằng tổng thanh toán",
      description: `${arithmetic.length.toLocaleString("vi-VN")} dòng chứng từ có tổng thanh toán khác tổng của tiền hàng và thuế. Hóa đơn in ra từ phần mềm không bao giờ sai phép cộng; sai số là dấu hiệu bị sửa số tay.`,
      recommendation: "Đối chiếu từng hóa đơn với bản gốc/hóa đơn điện tử đã tra cứu trên cổng của cơ quan thuế.",
      records: sortByAmountDesc(arithmetic),
      notes,
    });
  }

  const oddRate: AuditRecord[] = [];
  const rateNotes = new Map<string, string>();
  for (const r of ctx.records) {
    if (r.net === undefined || r.tax === undefined || r.net <= 0 || r.tax < 0) continue;
    const rate = r.tax / r.net;
    const nearest = COMMON_VAT.reduce((best, v) => (Math.abs(v - rate) < Math.abs(best - rate) ? v : best), COMMON_VAT[0]);
    if (Math.abs(rate - nearest) > 0.004) {
      oddRate.push(r);
      rateNotes.set(r.id, `Thuế suất suy ra ${fmtPct(rate)} (không thuộc 0/5/8/10%)`);
    }
  }
  if (oddRate.length > 0) {
    out.push({
      rule: "row_arithmetic",
      severity: "medium",
      title: "Thuế suất suy ra không thuộc mức thông dụng",
      description: `${oddRate.length.toLocaleString("vi-VN")} dòng có thuế suất tính ngược (thuế ÷ tiền hàng) khác các mức 0%, 5%, 8%, 10%. Có thể do làm tròn nhiều dòng hàng, hóa đơn nhiều thuế suất, hoặc số bị sửa.`,
      recommendation: "Kiểm tra các hóa đơn này; nếu hóa đơn có nhiều dòng hàng với thuế suất khác nhau thì có thể hợp lệ.",
      records: sortByAmountDesc(oddRate),
      notes: rateNotes,
    });
  }
  return out;
}
