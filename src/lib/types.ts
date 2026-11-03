// Các kiểu dữ liệu dùng chung giữa server (parser, luật, AI) và client (giao diện).
// File này KHÔNG được import module chỉ chạy trên server.

import type { ShopFileData, ShopSummary, ShopTabGroup } from "@/lib/shop/types";

export type SourceRole = "ledger" | "bank" | "invoice" | "other";
export type RoleSetting = SourceRole | "auto";
export type Severity = "high" | "medium" | "low" | "info";

export type RuleCategory =
  | "integrity"
  | "reconciliation"
  | "fraud_pattern"
  | "statistical"
  | "control";

export type RuleId =
  | "duplicate_row"
  | "duplicate_reference"
  | "possible_duplicate_payment"
  | "split_transaction"
  | "threshold_bunching"
  | "round_amount"
  | "benford"
  | "outlier"
  | "weekend_holiday"
  | "future_date"
  | "out_of_period"
  | "backdated"
  | "sequence_gap"
  | "balance_break"
  | "total_mismatch"
  | "row_arithmetic"
  | "hidden_content"
  | "document_metadata"
  | "similar_party"
  | "tax_code_conflict"
  | "risk_keyword"
  | "recon_unmatched"
  | "recon_amount_mismatch"
  | "recon_low_match_rate"
  // ---- kiểm tiền của shop ký gửi
  | "lot_amount_mismatch"
  | "lot_unpaid"
  | "payout_duplicate"
  | "payout_orphan"
  | "system_mismatch"
  | "declared_total"
  | "ledger_footing"
  | "ledger_continuity"
  | "ledger_entry_issue"
  | "day_mismatch"
  | "bank_ledger_mismatch"
  | "statement_gap"
  | "report_mismatch"
  | "revenue_mismatch"
  | "rule_error";

/** Một dòng giao dịch/chứng từ đã được chuẩn hóa từ file gốc. */
export interface AuditRecord {
  /** Mã ngắn, duy nhất trong một lần phân tích, ví dụ "F1-0023". */
  id: string;
  fileId: string;
  fileName: string;
  role: SourceRole;
  /** Tên sheet (Excel) hoặc "Trang N" (PDF). */
  sheet?: string;
  /** Số dòng trong file gốc (bắt đầu từ 1). */
  row: number;
  /** Ngày dạng YYYY-MM-DD. */
  date?: string;
  description?: string;
  counterparty?: string;
  taxCode?: string;
  reference?: string;
  /** Ký hiệu hóa đơn (series), nếu file có cột riêng. */
  series?: string;
  debit?: number;
  credit?: number;
  /** Giá trị có dấu khi file chỉ có một cột số tiền. */
  signed?: number;
  /** Độ lớn của giao dịch (>= 0). */
  amount: number;
  net?: number;
  tax?: number;
  /** gross - (net + tax) nếu file có đủ 3 cột; dùng để bắt sai số học. */
  calcDiff?: number;
  balance?: number;
}

export interface DeclaredTotal {
  sheet?: string;
  row: number;
  label: string;
  debit?: number;
  credit?: number;
  amount?: number;
  net?: number;
  tax?: number;
  /** Số bản ghi (của file này, cùng sheet) đứng trước dòng tổng cộng. */
  recordCountBefore: number;
}

export interface HiddenInfo {
  sheets: { name: string; state: "hidden" | "veryHidden"; hasData: boolean }[];
  rows: { sheet: string; rows: number[] }[];
  columns: { sheet: string; columns: string[] }[];
}

export interface DocMetadata {
  author?: string;
  lastAuthor?: string;
  creator?: string;
  producer?: string;
  application?: string;
  created?: string;
  modified?: string;
}

export type FileKind = "spreadsheet" | "csv" | "text" | "pdf" | "word";

/** Kết quả AI đề xuất bố cục cho một tab chưa nhận diện (để giao diện cho người dùng thấy AI đã làm gì và vì sao). */
export interface AiStructureNote {
  sheet: string;
  status: "accepted" | "rejected" | "none" | "cached" | "no_answer";
  message: string;
  /** Loại bảng AI nhận diện (khi đã qua kiểm chứng). */
  kind?: string;
  confidence?: "high" | "medium" | "low";
  rows?: number;
}

/** Thông tin đầu/cuối của một sao kê ngân hàng (không gồm tên chủ tài khoản, địa chỉ, CMND). */
export interface StatementMeta {
  sheet: string;
  /** Kỳ sao kê (YYYY-MM-DD). */
  from?: string;
  to?: string;
  opening?: number;
  closing?: number;
  /** Số tài khoản đã che, chỉ còn 4 số cuối. */
  account?: string;
}

/** Kết quả đọc một file (chưa gán vai trò cuối cùng). */
export interface ParsedFile {
  fileId: string;
  fileName: string;
  kind: FileKind;
  sizeBytes: number;
  guessedRole: SourceRole;
  records: AuditRecord[];
  declaredTotals: DeclaredTotal[];
  /** Các bảng nghiệp vụ của shop đã nhận diện trong file (không chứa dữ liệu cá nhân của khách). */
  shop?: ShopFileData;
  /** Kỳ và số dư đầu/cuối của các sao kê ngân hàng trong file. */
  statements?: StatementMeta[];
  /** Có khi người dùng bật AI nhận diện bảng lạ: AI đã đề xuất gì cho từng tab chưa nhận diện và code kiểm chứng ra sao. */
  aiStructure?: AiStructureNote[];
  /** Trích đoạn văn bản (cho AI) với tài liệu dạng văn bản. */
  textExcerpt?: string;
  warnings: string[];
  hidden: HiddenInfo;
  metadata: DocMetadata;
  sheets: string[];
  rowsScanned: number;
  rowsSkipped: number;
  /** Có lỗi nghiêm trọng khiến không đọc được file. */
  error?: string;
}

export interface FileSummary {
  fileId: string;
  fileName: string;
  kind: FileKind;
  sizeBytes: number;
  role: SourceRole;
  guessedRole: SourceRole;
  roleSetting: RoleSetting;
  records: number;
  rowsSkipped: number;
  sheets: string[];
  warnings: string[];
  dateFrom?: string;
  dateTo?: string;
  totalDebit: number;
  totalCredit: number;
  totalAmount: number;
  error?: string;
  /**
   * Các bảng nghiệp vụ của shop nhận diện được trong file (bảng lô, sổ thu chi, báo cáo tháng, file xuất từ hệ thống...).
   * File như vậy được đọc đầy đủ theo từng bảng nên `records` (dòng giao dịch kiểu sao kê) bằng 0 là bình thường, không phải file lỗi.
   */
  shopTables?: ShopTabGroup[];
  /** Số tab của file chưa nhận diện được (không đưa vào kiểm tra). */
  shopUnknownTabs?: number;
}

export interface AuditSettings {
  /** Các ngưỡng phê duyệt / ngưỡng rủi ro cần canh (VND). */
  thresholds: number[];
  /** Độ rộng dải "sát dưới ngưỡng", tính bằng % của ngưỡng. */
  thresholdBandPct: number;
  /** Dung sai số tiền khi đối chiếu (VND). */
  amountTolerance: number;
  /** Số ngày lệch tối đa khi ghép giao dịch giữa hai nguồn. */
  dateWindowDays: number;
  /** Cửa sổ ngày để gom giao dịch bị nghi tách nhỏ. */
  splitWindowDays: number;
  /** Cửa sổ ngày để nghi thanh toán trùng. */
  duplicateWindowDays: number;
  /** Bỏ qua các giao dịch nhỏ hơn mức này ở các luật dễ gây nhiễu. */
  minAmount: number;
  /** Đơn vị để coi là "số tiền tròn". */
  roundUnit: number;
  periodFrom?: string;
  periodTo?: string;
  /** Từ khóa rủi ro bổ sung do người dùng nhập. */
  keywords: string[];
  /**
   * Chế độ shop ký gửi (mặc định bật): chạy lớp kiểm tiền riêng của shop và tắt các luật thống kê hay gây báo động giả
   * trên dữ liệu của shop (Benford, số tiền tròn, ngày nghỉ, giá trị lớn, tách nhỏ, dồn sát ngưỡng, tên giống nhau, từ khóa).
   */
  shopMode?: boolean;
}

export const DEFAULT_SETTINGS: AuditSettings = {
  thresholds: [20_000_000, 50_000_000, 100_000_000, 200_000_000],
  thresholdBandPct: 5,
  amountTolerance: 0,
  dateWindowDays: 5,
  splitWindowDays: 3,
  duplicateWindowDays: 7,
  minAmount: 1_000_000,
  roundUnit: 1_000_000,
  keywords: [],
  shopMode: true,
};

export interface EvidenceRow extends AuditRecord {
  /** Ghi chú riêng cho dòng này (ví dụ số dư kỳ vọng, nhóm trùng). */
  note?: string;
}

export interface Finding {
  id: string;
  rule: RuleId;
  severity: Severity;
  title: string;
  description: string;
  recommendation?: string;
  /** Số tiền liên quan (để xếp hạng ưu tiên). */
  amount: number;
  /** Tổng số dòng liên quan (evidence có thể bị cắt bớt). */
  totalRecords: number;
  evidence: EvidenceRow[];
  recordIds: string[];
  meta?: Record<string, string | number | boolean | string[]>;
}

export interface BenfordResult {
  fileId: string;
  fileName: string;
  n: number;
  /** Tỷ lệ chữ số đầu 1..9. */
  observed: number[];
  expected: number[];
  counts: number[];
  mad: number;
  chiSquare: number;
  conformity: "close" | "acceptable" | "marginal" | "nonconforming";
  digitFlags: { digit: number; observed: number; expected: number; z: number }[];
  pairSpikes: { pair: number; observed: number; expected: number; z: number; count: number }[];
}

export interface BenfordSkipped {
  fileId: string;
  fileName: string;
  n: number;
}

export interface ReconciliationSummary {
  id: string;
  leftRole: SourceRole;
  rightRole: SourceRole;
  leftLabel: string;
  rightLabel: string;
  leftCount: number;
  rightCount: number;
  leftAmount: number;
  rightAmount: number;
  matched: number;
  matchedGroups: number;
  amountMismatches: number;
  leftUnmatched: number;
  rightUnmatched: number;
  leftUnmatchedAmount: number;
  rightUnmatchedAmount: number;
  /** Có đánh giá phần chưa khớp của bên phải hay không (hóa đơn ↔ sổ sách thì không). */
  rightUnmatchedReported: boolean;
  matchRate: number;
}

export interface AiDigest {
  topCounterparties: { name: string; count: number; total: number }[];
  monthly: { month: string; count: number; total: number }[];
  largest: AuditRecord[];
  sample: AuditRecord[];
  textExcerpts: { fileId: string; role: SourceRole; excerpt: string }[];
}

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface AnalysisResult {
  generatedAt: string;
  settings: AuditSettings;
  files: FileSummary[];
  totals: {
    records: number;
    debit: number;
    credit: number;
    amount: number;
    dateFrom?: string;
    dateTo?: string;
  };
  findings: Finding[];
  severityCounts: Record<Severity, number>;
  benford: BenfordResult[];
  benfordSkipped: BenfordSkipped[];
  reconciliation: ReconciliationSummary[];
  riskScore: number;
  riskLevel: RiskLevel;
  digest: AiDigest;
  /** Danh sách dòng đã chuẩn hóa (có thể bị cắt để giảm dung lượng). */
  records: AuditRecord[];
  recordsTruncated: boolean;
  /** Kết quả kiểm tiền của shop ký gửi (có khi file chứa bảng của shop hoặc sao kê). */
  shop?: ShopSummary;
  /** Khi bật "AI nhận diện bảng lạ": AI đã đề xuất gì cho từng tab chưa nhận diện và code kiểm chứng ra sao. */
  aiStructure?: (AiStructureNote & { fileId: string; fileName: string })[];
  /** Lý do AI nhận diện bảng lạ không chạy dù đã bật (ví dụ chưa cấu hình khóa). */
  aiStructureSkipped?: string;
}

export interface AiFindingReview {
  findingId: string;
  verdict: "likely_issue" | "needs_followup" | "likely_benign";
  comment: string;
  procedures: string[];
}

export interface AiObservation {
  title: string;
  detail: string;
  severity: "high" | "medium" | "low";
  recordIds: string[];
}

export interface AiReview {
  provider: string;
  model: string;
  anonymized: boolean;
  overallAssessment: string;
  riskLevel: "low" | "medium" | "high";
  findingReviews: AiFindingReview[];
  additionalObservations: AiObservation[];
  questions: string[];
  limitations: string[];
  /** Văn bản thô khi AI không trả về JSON hợp lệ. */
  rawText?: string;
}

export interface AiStatus {
  configured: boolean;
  provider?: string;
  model?: string;
}
