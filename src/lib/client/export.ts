// Xuất báo cáo kiểm toán ra Excel (chạy trong trình duyệt, không gửi dữ liệu đi đâu).

import { CATEGORY_LABELS, RULE_CATALOG, ROLE_LABELS, SEVERITY_LABELS } from "@/lib/audit/catalog";
import { resolveRows } from "@/lib/client/evidence";
import { shopSheets } from "@/lib/client/export-shop";
import type { AiReview, AnalysisResult, AuditRecord } from "@/lib/types";
import { fmtDate } from "@/lib/util/stats";

const VERDICT_LABEL: Record<string, string> = {
  likely_issue: "Nhiều khả năng là vấn đề thật",
  needs_followup: "Cần theo dõi thêm",
  likely_benign: "Nhiều khả năng hợp lệ",
};

export async function exportReport(
  result: AnalysisResult,
  reviewed: Set<string>,
  ai: AiReview | null,
  lookup: Map<string, AuditRecord>,
): Promise<void> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const addSheet = (name: string, rows: (string | number)[][], widths: number[]) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  const reviewByFinding = new Map(ai?.findingReviews.map((r) => [r.findingId, r]) ?? []);

  // ---- Tổng quan
  const overview: (string | number)[][] = [
    ["BÁO CÁO KIỂM TOÁN TỰ ĐỘNG"],
    ["Thời điểm phân tích", result.generatedAt.slice(0, 19).replace("T", " ")],
    ["Điểm rủi ro (0-100)", result.riskScore],
    ["Số dòng giao dịch", result.totals.records],
    ["Kỳ dữ liệu", `${fmtDate(result.totals.dateFrom)} - ${fmtDate(result.totals.dateTo)}`],
    ["Phát hiện mức Cao", result.severityCounts.high],
    ["Phát hiện mức Trung bình", result.severityCounts.medium],
    ["Phát hiện mức Thấp", result.severityCounts.low],
    [],
    ["Mã", "File", "Loại", "Số dòng đọc được", "Từ ngày", "Đến ngày", "Tổng Nợ/Ghi nợ", "Tổng Có/Ghi có", "Ghi chú khi đọc file"],
    ...result.files.map((f) => {
      // File bảng lô, sổ thu chi, báo cáo tháng, file hệ thống được đọc theo từng bảng nghiệp vụ: không có dòng giao dịch kiểu sao kê.
      const tables = f.shopTables ?? [];
      const isShop = tables.length > 0;
      const shopNote = isShop
        ? `Đã nhận diện: ${tables
            .map((t) => `${t.label}${t.kind === "gaProducts" ? " (để kiểm hàng sau)" : ""} ${t.count} tab, ${t.rows.toLocaleString("vi-VN")} dòng`)
            .join("; ")}${f.shopUnknownTabs ? `; ${f.shopUnknownTabs} tab chưa nhận diện` : ""}`
        : "";
      return [
        f.fileId,
        f.fileName,
        isShop ? "Bảng của shop" : ROLE_LABELS[f.role],
        isShop ? tables.reduce((s, t) => s + t.rows, 0) : f.records,
        fmtDate(f.dateFrom),
        fmtDate(f.dateTo),
        isShop ? "" : f.totalDebit,
        isShop ? "" : f.totalCredit,
        f.error ? `LỖI: ${f.error}` : [shopNote, ...f.warnings].filter(Boolean).join(" | "),
      ];
    }),
    [],
    ["Lưu ý: các phát hiện là dấu hiệu bất thường cần kiểm tra thêm, không phải kết luận về gian lận."],
  ];
  addSheet("Tổng quan", overview, [28, 40, 22, 12, 14, 14, 18, 18, 80]);

  // ---- Kiểm tiền của shop (phép kiểm theo tháng, số liệu từng nguồn, dữ liệu còn thiếu, nguồn đã nhận diện)
  if (result.shop) {
    for (const s of shopSheets(result.shop, result.aiStructure ?? [])) addSheet(s.name, s.rows, s.widths);
  }

  // ---- Phát hiện
  addSheet(
    "Phát hiện",
    [
      ["Mã", "Mức độ", "Nhóm", "Loại", "Tiêu đề", "Mô tả", "Khuyến nghị", "Số tiền liên quan", "Số dòng", "Đã xem xét", "AI nhận định", "AI ghi chú"],
      ...result.findings.map((f) => {
        const info = RULE_CATALOG[f.rule];
        const r = reviewByFinding.get(f.id);
        return [
          f.id,
          SEVERITY_LABELS[f.severity],
          CATEGORY_LABELS[info.category],
          info.label,
          f.title,
          f.description,
          f.recommendation ?? "",
          Math.round(f.amount),
          f.totalRecords,
          reviewed.has(f.id) ? "Đã xem xét" : "",
          r ? VERDICT_LABEL[r.verdict] : "",
          r ? `${r.comment}${r.procedures.length ? ` | Thủ tục: ${r.procedures.join("; ")}` : ""}` : "",
        ];
      }),
    ],
    [9, 12, 20, 32, 40, 80, 60, 18, 10, 12, 28, 80],
  );

  // ---- Bằng chứng
  const evidence: (string | number)[][] = [
    ["Mã phát hiện", "Mã dòng", "File", "Sheet/Trang", "Dòng", "Ngày", "Số chứng từ", "Diễn giải", "Đối tượng", "MST", "Nợ", "Có", "Số tiền", "Số dư", "Ghi chú"],
  ];
  for (const f of result.findings) {
    for (const e of resolveRows(f, lookup)) {
      evidence.push([
        f.id,
        e.id,
        e.fileName,
        e.sheet ?? "",
        e.row,
        fmtDate(e.date),
        e.reference ?? "",
        e.description ?? "",
        e.counterparty ?? "",
        e.taxCode ?? "",
        e.debit ?? "",
        e.credit ?? "",
        e.amount,
        e.balance ?? "",
        e.note ?? "",
      ]);
    }
  }
  addSheet("Bằng chứng", evidence, [12, 11, 30, 14, 7, 12, 16, 50, 30, 14, 16, 16, 16, 18, 60]);

  // ---- Đối chiếu
  if (result.reconciliation.length > 0) {
    addSheet(
      "Đối chiếu",
      [
        ["Cặp nguồn", "Số dòng bên trái", "Số dòng bên phải", "Ghép 1-1", "Ghép nhóm", "Lệch số tiền", "Chưa khớp (trái)", "Giá trị chưa khớp (trái)", "Chưa khớp (phải)", "Giá trị chưa khớp (phải)", "Tỷ lệ khớp"],
        ...result.reconciliation.map((r) => [
          `${r.leftLabel} ↔ ${r.rightLabel}`,
          r.leftCount,
          r.rightCount,
          r.matched,
          r.matchedGroups,
          r.amountMismatches,
          r.leftUnmatched,
          Math.round(r.leftUnmatchedAmount),
          r.rightUnmatchedReported ? r.rightUnmatched : "Không xét",
          r.rightUnmatchedReported ? Math.round(r.rightUnmatchedAmount) : "Không xét",
          `${(r.matchRate * 100).toFixed(1)}%`,
        ]),
      ],
      [40, 16, 16, 12, 12, 14, 16, 24, 16, 24, 12],
    );
  }

  // ---- Benford
  if (result.benford.length > 0) {
    const rows: (string | number)[][] = [["File", "Chữ số đầu", "Số dòng", "Thực tế (%)", "Kỳ vọng Benford (%)"]];
    for (const b of result.benford) {
      b.observed.forEach((p, i) => rows.push([b.fileId, i + 1, b.counts[i], Number((p * 100).toFixed(2)), Number((b.expected[i] * 100).toFixed(2))]));
      rows.push([b.fileId, "MAD", Number(b.mad.toFixed(4)), "chi-square", Number(b.chiSquare.toFixed(1))]);
    }
    addSheet("Benford", rows, [10, 12, 12, 14, 20]);
  }

  // ---- AI
  if (ai) {
    const rows: (string | number)[][] = [
      ["Nhận xét tổng quan (AI)", ai.overallAssessment],
      ["Mức rủi ro theo AI", { low: "Thấp", medium: "Trung bình", high: "Cao" }[ai.riskLevel]],
      ["Mô hình", `${ai.provider} / ${ai.model}${ai.anonymized ? " (đã ẩn danh hóa dữ liệu)" : ""}`],
      [],
      ["Bất thường bổ sung", "Mô tả", "Mức độ", "Mã dòng"],
      ...ai.additionalObservations.map((o) => [o.title, o.detail, SEVERITY_LABELS[o.severity], o.recordIds.join(", ")]),
      [],
      ["Câu hỏi cần hỏi kế toán/ban giám đốc"],
      ...ai.questions.map((q) => [q]),
      [],
      ["Hạn chế"],
      ...ai.limitations.map((l) => [l]),
      [],
      ["Nhận xét của AI chỉ mang tính tham khảo, cần được kiểm toán viên xác minh."],
    ];
    addSheet("AI", rows, [40, 100, 14, 40]);
  }

  XLSX.writeFile(wb, `bao-cao-kiem-toan-${result.generatedAt.slice(0, 10)}.xlsx`);
}
