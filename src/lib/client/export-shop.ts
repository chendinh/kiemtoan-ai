// Các sheet kiểm tiền của shop trong báo cáo Excel. Tách riêng thành hàm thuần (không phụ thuộc thư viện xlsx) để kiểm thử được.

import { MONTHS, STATUS_LABELS, groupChecks, groupFigures } from "@/lib/shop/checks";
import { KIND_LABELS, type ShopCheck, type ShopSummary, type ShopTableKind } from "@/lib/shop/types";
import type { AnalysisResult } from "@/lib/types";
import { fmtDate } from "@/lib/util/stats";

export interface SheetSpec {
  name: string;
  rows: (string | number)[][];
  widths: number[];
}

const AI_STATUS_LABEL: Record<string, string> = {
  accepted: "Đã nhận (code kiểm chứng đạt)",
  cached: "Đã nhận (dùng lại bố cục đã duyệt)",
  rejected: "Bị từ chối (code kiểm chứng không đạt)",
  none: "AI không nhận ra",
  no_answer: "Không có câu trả lời",
};

function monthCell(c: ShopCheck, month: number): string {
  const m = c.months[month];
  if (!m) return "";
  return m.status === "issue" ? `Lệch ${m.issues}` : "Đạt";
}

export function shopSheets(shop: ShopSummary, aiStructure: AnalysisResult["aiStructure"] = []): SheetSpec[] {
  const sheets: SheetSpec[] = [];
  const monthHeads = MONTHS.map((m) => `T${m}`);

  // ---- Phép kiểm theo tháng
  const checks: (string | number)[][] = [
    [`KIỂM TIỀN NĂM ${shop.year}`],
    [`Từ ${fmtDate(shop.from)} đến ${fmtDate(shop.asOf)} (ngày có giao dịch mới nhất trong dữ liệu).`],
    ["Ô tháng để trống là tháng không có dữ liệu để kiểm, không phải đạt. “Chưa kiểm được” nghĩa là thiếu dữ liệu để so. Số tiền lệch của các phép kiểm khác nhau có thể trùng nhau (một khoản lệch bị nhiều phép kiểm cùng thấy) nên không cộng lại."],
    [],
    ["Nhóm", "Phép kiểm", "Kết quả", "Số mục lệch", "Số tiền lệch (đồng)", "Chi tiết", ...monthHeads],
  ];
  for (const g of groupChecks(shop.checks)) {
    for (const c of g.checks) {
      checks.push([g.label, c.label, STATUS_LABELS[c.status], c.issues, Math.round(c.amount), c.detail, ...MONTHS.map((m) => monthCell(c, m))]);
    }
  }
  sheets.push({ name: `Kiểm tiền ${shop.year}`, rows: checks, widths: [34, 60, 16, 12, 20, 50, ...MONTHS.map(() => 9)] });

  // ---- Số liệu theo tháng của từng nguồn (đồng)
  if (shop.figures.length > 0) {
    const rows: (string | number)[][] = [
      [`Số liệu theo tháng của năm ${shop.year}, đơn vị đồng. Ô trống là tháng nguồn đó không có số.`],
      [],
      ["Nhóm", "Số liệu", "Nguồn", ...monthHeads],
    ];
    for (const g of groupFigures(shop.figures)) {
      for (const f of g.figures) rows.push([g.title, f.label, f.source, ...MONTHS.map((m) => (f.months[m] === undefined ? "" : Math.round(f.months[m])))]);
    }
    sheets.push({ name: "Số liệu theo tháng", rows, widths: [34, 44, 50, ...MONTHS.map(() => 16)] });
  }

  // ---- Dữ liệu còn thiếu và giới hạn
  if (shop.coverage.length > 0) {
    const ordered = [...shop.coverage.filter((c) => c.level === "warn"), ...shop.coverage.filter((c) => c.level === "info")];
    sheets.push({
      name: "Thiếu dữ liệu",
      rows: [["Mức", "Nội dung", "Chi tiết"], ...ordered.map((c) => [c.level === "warn" ? "Cần bổ sung" : "Ghi chú", c.label, c.detail ?? ""])],
      widths: [14, 80, 100],
    });
  }

  // ---- Nguồn đã nhận diện, tab chưa nhận diện và kết quả AI nhận diện bảng lạ
  const sources: (string | number)[][] = [["File", "Loại bảng", "Số tab", "Trong đó ẩn", "Số dòng"]];
  for (const s of shop.sources) for (const t of s.tabs) sources.push([`${s.fileId} · ${s.fileName}`, t.label, t.count, t.hidden, t.rows]);
  const unknown = shop.sources.flatMap((s) => s.unknownTabs.map((u) => [`${s.fileId} · ${s.fileName}`, u.sheet, u.hidden ? "Ẩn" : "", u.rows, u.headers.join(" · ")] as (string | number)[]));
  if (unknown.length > 0) {
    sources.push([], ["Tab chưa nhận diện (không đưa vào kiểm tra)"], ["File", "Tab", "Ẩn", "Số dòng", "Tiêu đề cột"], ...unknown);
  }
  if (aiStructure.length > 0) {
    sources.push([], ["AI nhận diện bảng lạ (AI chỉ đề xuất, code kiểm chứng trước khi dùng)"], ["File", "Tab", "Kết quả", "Loại bảng", "Ghi chú"]);
    for (const n of aiStructure) {
      sources.push([`${n.fileId} · ${n.fileName}`, n.sheet, AI_STATUS_LABEL[n.status] ?? n.status, n.kind ? (KIND_LABELS[n.kind as ShopTableKind] ?? n.kind) : "", n.message]);
    }
  }
  sheets.push({ name: "Nguồn đã nhận diện", rows: sources, widths: [46, 40, 36, 30, 80] });

  return sheets;
}
