// Danh mục luật kiểm toán: nhãn tiếng Việt và ý nghĩa. Dùng chung cho server và giao diện.

import type { RuleCategory, RuleId, Severity, SourceRole } from "@/lib/types";

export interface RuleInfo {
  label: string;
  category: RuleCategory;
  /** Vì sao dấu hiệu này đáng chú ý. */
  why: string;
}

export const RULE_CATALOG: Record<RuleId, RuleInfo> = {
  duplicate_row: {
    label: "Dòng giao dịch trùng lặp",
    category: "fraud_pattern",
    why: "Cùng ngày, cùng số tiền, cùng diễn giải/chứng từ xuất hiện nhiều lần. Có thể là ghi sổ hai lần, thanh toán hai lần hoặc dựng chứng từ.",
  },
  duplicate_reference: {
    label: "Số chứng từ/hóa đơn bị dùng lặp",
    category: "fraud_pattern",
    why: "Một số chứng từ hoặc hóa đơn không nên xuất hiện lặp lại với số tiền trùng hoặc mâu thuẫn. Dấu hiệu thường gặp của hóa đơn bị dùng hai lần hoặc bị sửa.",
  },
  possible_duplicate_payment: {
    label: "Nghi thanh toán trùng",
    category: "fraud_pattern",
    why: "Cùng đối tác, cùng số tiền, cách nhau vài ngày nhưng khác số chứng từ. Rủi ro chi trùng hoặc chi hai lần cho một khoản.",
  },
  split_transaction: {
    label: "Nghi tách nhỏ giao dịch",
    category: "fraud_pattern",
    why: "Nhiều khoản nhỏ cho cùng đối tác trong thời gian ngắn, mỗi khoản dưới ngưỡng nhưng tổng vượt ngưỡng. Thủ thuật né hạn mức phê duyệt.",
  },
  threshold_bunching: {
    label: "Dồn số tiền sát dưới ngưỡng",
    category: "fraud_pattern",
    why: "Số giao dịch ngay dưới ngưỡng phê duyệt nhiều bất thường so với ngay trên ngưỡng. Gợi ý việc cố ý giữ số tiền dưới hạn mức.",
  },
  round_amount: {
    label: "Tỷ lệ số tiền tròn cao",
    category: "statistical",
    why: "Số tiền tròn triệu/tròn chục triệu chiếm tỷ lệ lớn thường là số ước lượng hoặc số do người nhập tự đặt, không phải số phát sinh thực tế.",
  },
  benford: {
    label: "Phân phối chữ số đầu lệch Benford",
    category: "statistical",
    why: "Số liệu phát sinh tự nhiên thường tuân theo quy luật Benford. Lệch lớn gợi ý dữ liệu bị tạo/chỉnh sửa hoặc có nhóm giao dịch bất thường.",
  },
  outlier: {
    label: "Giá trị lớn bất thường",
    category: "statistical",
    why: "Số tiền lớn hơn nhiều so với lịch sử của cùng đối tác hoặc so với mặt bằng chung của nguồn dữ liệu.",
  },
  weekend_holiday: {
    label: "Giao dịch ngày nghỉ/lễ",
    category: "control",
    why: "Bút toán hoặc chứng từ có giá trị lớn vào cuối tuần hoặc ngày lễ nằm ngoài sinh hoạt bình thường, thường là chỗ hở của kiểm soát nội bộ.",
  },
  future_date: {
    label: "Ngày chứng từ ở tương lai",
    category: "control",
    why: "Chứng từ ghi ngày sau thời điểm hiện tại. Có thể là nhập sai hoặc ghi nhận doanh thu/chi phí trước hạn.",
  },
  out_of_period: {
    label: "Ngoài kỳ kiểm toán",
    category: "control",
    why: "Giao dịch nằm ngoài kỳ đã khai báo. Cần xem xét cắt kỳ (cut-off) và việc ghi nhận sai kỳ.",
  },
  backdated: {
    label: "Nghi lùi ngày chứng từ",
    category: "fraud_pattern",
    why: "Số chứng từ lớn hơn nhưng ngày lại cũ hơn các chứng từ trước đó. Dấu hiệu lập chứng từ sau rồi ghi lùi ngày.",
  },
  sequence_gap: {
    label: "Đứt quãng dãy số chứng từ",
    category: "control",
    why: "Dãy số hóa đơn/chứng từ bị thiếu số. Có thể là hóa đơn hủy hợp lệ hoặc là doanh thu/chi phí chưa được ghi nhận.",
  },
  balance_break: {
    label: "Đứt gãy số dư lũy kế",
    category: "integrity",
    why: "Số dư sau mỗi dòng không bằng số dư trước cộng/trừ số phát sinh. Bản sao kê/sổ có thể đã bị chèn, xóa hoặc sửa số.",
  },
  total_mismatch: {
    label: "Dòng tổng cộng không khớp",
    category: "integrity",
    why: "Tổng ghi trên file khác với tổng tính lại từ các dòng chi tiết. Dấu hiệu sửa số tay hoặc dòng bị ẩn/xóa.",
  },
  row_arithmetic: {
    label: "Sai số học trên dòng chứng từ",
    category: "integrity",
    why: "Tiền hàng cộng thuế không bằng tổng thanh toán, hoặc thuế suất suy ra không thuộc các mức thông dụng. Có thể chứng từ đã bị chỉnh.",
  },
  hidden_content: {
    label: "Nội dung ẩn trong file",
    category: "integrity",
    why: "Sheet, hàng hoặc cột bị ẩn chứa dữ liệu. Cần mở ra xem vì có thể che giấu giao dịch hoặc công thức.",
  },
  document_metadata: {
    label: "Dấu hiệu tài liệu bị chỉnh sửa",
    category: "integrity",
    why: "Siêu dữ liệu của file (công cụ tạo, người sửa, thời điểm sửa) cho thấy file có thể đã qua chỉnh sửa sau khi xuất. Cần đối chiếu với bản gốc từ nguồn phát hành.",
  },
  similar_party: {
    label: "Tên đối tác gần giống nhau",
    category: "fraud_pattern",
    why: "Nhiều tên rất giống nhau có thể là cùng một đối tác bị tách để né hạn mức, hoặc đối tác ma tạo ra bằng cách đổi vài ký tự.",
  },
  tax_code_conflict: {
    label: "Mã số thuế và tên đối tác mâu thuẫn",
    category: "fraud_pattern",
    why: "Một mã số thuế đi với nhiều tên, hoặc một tên đi với nhiều mã số thuế. Thường gặp ở hóa đơn không hợp lệ hoặc đối tác không có thật.",
  },
  risk_keyword: {
    label: "Từ khóa rủi ro trong diễn giải",
    category: "control",
    why: "Diễn giải có từ gắn với rủi ro (tiền mặt, tạm ứng, điều chỉnh, hoa hồng, quà tặng...). Chỉ là gợi ý để chọn mẫu kiểm tra chi tiết.",
  },
  recon_unmatched: {
    label: "Giao dịch không đối chiếu được",
    category: "reconciliation",
    why: "Giao dịch có ở nguồn này nhưng không tìm thấy bản ghi tương ứng ở nguồn kia theo số tiền, ngày và chứng từ.",
  },
  recon_amount_mismatch: {
    label: "Cùng chứng từ nhưng lệch số tiền",
    category: "reconciliation",
    why: "Cùng một số chứng từ nhưng số tiền ở hai nguồn khác nhau. Đây là dấu hiệu rõ nhất của việc sửa số hoặc ghi sai.",
  },
  rule_error: {
    label: "Luật kiểm tra gặp lỗi",
    category: "integrity",
    why: "Một luật kiểm tra bị lỗi khi chạy trên dữ liệu này nên không có kết quả. Hãy báo cho người phát triển kèm file mẫu.",
  },
  recon_low_match_rate: {
    label: "Tỷ lệ đối chiếu thấp",
    category: "reconciliation",
    why: "Rất ít giao dịch ghép được giữa hai nguồn. Thường do chọn nhầm phạm vi file (ví dụ sổ cái tổng hợp thay vì sổ tiền gửi) hoặc kỳ dữ liệu không trùng nhau.",
  },
  lot_amount_mismatch: {
    label: "Tiền chuyển khác số phải trả của lô",
    category: "reconciliation",
    why: "Tổng tiền đã chuyển cho một lô ký gửi khác số phải trả ghi ở bảng lô hoặc hệ thống. Trả vượt là tiền ra khỏi shop không có căn cứ; trả thiếu là khách chưa nhận đủ.",
  },
  lot_unpaid: {
    label: "Lô đã đến hạn chưa thấy chuyển khoản",
    category: "reconciliation",
    why: "Lô có số phải trả nhưng không có dòng chuyển khoản nào. Có thể chưa trả (nợ khách), đã trả nhưng quên ghi vào danh sách chuyển khoản, hoặc ghi sai mã lô.",
  },
  payout_duplicate: {
    label: "Dòng chuyển khoản bị ghi trùng",
    category: "fraud_pattern",
    why: "Cùng một mã lô, cùng số tiền xuất hiện nhiều lần. Hoặc tiền đã bị chuyển hai lần, hoặc cùng một lần chuyển bị chép vào hai tab (làm tổng đã trả bị thổi phồng).",
  },
  payout_orphan: {
    label: "Chuyển khoản không có lô tương ứng",
    category: "reconciliation",
    why: "Có dòng chuyển tiền cho một mã lô mà bảng lô của đợt đó không có. Tiền ra không có chứng từ phải trả đi kèm.",
  },
  system_mismatch: {
    label: "Hệ thống quản lý ký gửi lệch với sổ",
    category: "reconciliation",
    why: "Số phải trả, trạng thái thanh toán hoặc danh sách đơn trong hệ thống khác với bảng lô và danh sách chuyển khoản. Sheet có thể bị sửa tay sau khi hệ thống tính, hoặc hệ thống chưa cập nhật.",
  },
  declared_total: {
    label: "Ô tổng cộng không đúng",
    category: "integrity",
    why: "Ô tổng gõ tay lệch với tổng tính lại, công thức SUM bỏ sót hàng, hoặc số bị lưu dạng chữ nên không được cộng. Báo cáo lấy theo ô tổng sẽ sai theo.",
  },
  ledger_footing: {
    label: "Số dư sổ thu chi không khớp phép tính",
    category: "integrity",
    why: "Số dư còn lại sau mỗi dòng phải bằng số dư trước cộng tiền nhận trừ các khoản chi. Lệch nghĩa là có khoản bị bỏ khỏi công thức, số dư bị gõ đè hoặc dòng bị sửa.",
  },
  ledger_continuity: {
    label: "Số dư đầu tháng không nối với cuối tháng trước",
    category: "integrity",
    why: "Số dư cuối của sổ tháng trước phải bằng số dư đầu của sổ tháng sau. Chênh lệch là tiền biến mất hoặc xuất hiện giữa hai kỳ mà không có bút toán.",
  },
  ledger_entry_issue: {
    label: "Bút toán bất thường trong sổ thu chi",
    category: "control",
    why: "Ô số liệu nằm ngoài sổ, ngày sai thứ tự, số dư âm hoặc cùng một khoản ghi ở hai tab. Những lỗi này làm sổ không đáng tin dù từng dòng nhìn có vẻ hợp lý.",
  },
  day_mismatch: {
    label: "Chi trả theo ngày lệch giữa các sổ",
    category: "reconciliation",
    why: "Tổng tiền trả khách trong một ngày phải bằng nhau ở sổ thu chi, danh sách chuyển khoản và tab tổng hợp ngày. Lệch ngày hoặc lệch số cho thấy có khoản chưa ghi đủ hoặc ghi sai kỳ.",
  },
  bank_ledger_mismatch: {
    label: "Sổ thu chi lệch với sao kê ngân hàng",
    category: "reconciliation",
    why: "Khoản tiền quản lý nhận trong sổ phải có lệnh chuyển tương ứng trên sao kê, và ngược lại. Khoản không khớp là chỗ có thể thất thoát hoặc ghi sổ thiếu.",
  },
  statement_gap: {
    label: "Thiếu hoặc đứt quãng sao kê",
    category: "integrity",
    why: "Sao kê không phủ hết kỳ kiểm, số dư đầu kỳ không nối với cuối kỳ trước, hoặc đầu kỳ cộng phát sinh không bằng cuối kỳ. Không có sao kê đủ thì không đối chiếu được tiền thực nhận.",
  },
  report_mismatch: {
    label: "Báo cáo tháng khác với sổ gốc",
    category: "integrity",
    why: "Báo cáo tháng là bảng chủ shop đọc nhưng các con số trong đó lấy tay từ sổ khác. Lệch so với sổ gốc nghĩa là báo cáo đang cho kết luận sai.",
  },
  revenue_mismatch: {
    label: "Doanh thu ngày không khớp",
    category: "integrity",
    why: "Doanh thu ngày phải bằng tổng các hình thức thu (chuyển khoản, tiền mặt, chi phí, chiết khấu) và bằng offline cộng online. Lệch hoặc lẫn đơn vị cho thấy ô bị gõ sai.",
  },
};

export const CATEGORY_LABELS: Record<RuleCategory, string> = {
  integrity: "Toàn vẹn dữ liệu",
  reconciliation: "Đối chiếu",
  fraud_pattern: "Dấu hiệu gian lận",
  statistical: "Thống kê",
  control: "Kiểm soát",
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  high: "Cao",
  medium: "Trung bình",
  low: "Thấp",
  info: "Thông tin",
};

export const SEVERITY_ORDER: Severity[] = ["high", "medium", "low", "info"];

export const ROLE_LABELS: Record<SourceRole, string> = {
  ledger: "Sổ sách kế toán",
  bank: "Sao kê ngân hàng",
  invoice: "Hóa đơn / chứng từ",
  other: "Khác",
};
