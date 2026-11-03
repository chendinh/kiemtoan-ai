// Kiểu dữ liệu của các bảng nghiệp vụ shop sau khi trích xuất từ Excel/Google Sheet.
// Cố ý KHÔNG có trường cho tên, số điện thoại, CMND, email, số tài khoản của khách ký gửi.
// File này chỉ chứa kiểu, được phép import từ cả server và giao diện.

export type ShopTableKind =
  | "lots" // bảng ký gửi theo lô ("Tổng kết")
  | "payouts" // danh sách chuyển khoản trả khách ("… - THÔNG TIN CK")
  | "ledger" // sổ thu chi ("… - THÔNG TIN NHẬN TIỀN")
  | "daySummary" // tổng hợp trả khách theo ngày (tab "926", "1026"...)
  | "revenue" // doanh thu ngày
  | "monthly" // báo cáo tháng
  | "gaOrders" // đơn ký gửi xuất từ hệ thống quản lý
  | "gaOverview" // tab tổng quan của file xuất từ hệ thống
  | "gaProducts"; // chi tiết sản phẩm xuất từ hệ thống (dùng cho kiểm hàng, chưa xử lý)

export const KIND_LABELS: Record<ShopTableKind, string> = {
  lots: "Bảng ký gửi theo lô",
  payouts: "Danh sách chuyển khoản trả khách",
  ledger: "Sổ thu chi",
  daySummary: "Tổng hợp trả khách theo ngày",
  revenue: "Doanh thu ngày",
  monthly: "Báo cáo tháng",
  gaOrders: "Đơn ký gửi (hệ thống)",
  gaOverview: "Tổng quan (hệ thống)",
  gaProducts: "Chi tiết sản phẩm (hệ thống)",
};

/** Nguồn của một bảng: file và tab. */
export interface SrcRef {
  fileId: string;
  fileName: string;
  sheet: string;
}

/** Bố cục đã nhận diện của một tab: loại bảng, hàng tiêu đề và cột của từng trường (chỉ số 0). */
export interface Layout {
  kind: ShopTableKind;
  headerRow: number;
  cols: Record<string, number>;
  /** Cách nhận diện: luật cố định hoặc do AI đề xuất rồi được code kiểm chứng. */
  via?: "rules" | "ai";
}

/** Ô số nhưng lưu dạng chữ: hàm SUM của Excel/Sheets bỏ qua ô này. */
export interface TextNumber {
  addr: string;
  text: string;
  field: string;
}

/** Ô tổng khai báo (gõ tay hoặc công thức) đứng ngoài các dòng dữ liệu. */
export interface DeclaredCell {
  field: string;
  addr: string;
  row: number;
  value: number;
  formula?: string;
  /** Phạm vi của SUM(Gx:Gy) nếu công thức có dạng đó. */
  range?: { col: string; from: number; to: number };
}

// ------------------------------------------------------------------ bảng ký gửi theo lô

export interface LotRow {
  row: number;
  /** Mã khách ký gửi đã chuẩn hóa: "004", "TH", "301+302". */
  code: string;
  /** Đợt (tháng-năm trả tiền): "926" là tháng 9/2026. */
  batch: string;
  key: string;
  qtyIn: number;
  qtySold: number;
  /** Số tiền phải trả khách (đồng). */
  owed: number;
  ckDate?: string;
  note?: string;
}

export interface LotsTable {
  src: SrcRef;
  hidden: boolean;
  headerRow: number;
  /** Đợt chiếm đa số dòng của bảng. */
  mainBatch?: string;
  rows: LotRow[];
  declared: DeclaredCell[];
  textNumbers: TextNumber[];
}

// ------------------------------------------------------------------ danh sách chuyển khoản

export interface PayoutRow {
  row: number;
  /** Ngày chuyển (điền xuống từ dòng đầu của nhóm). */
  date?: string;
  code: string;
  batch: string;
  key: string;
  /** Số tiền (đồng). */
  amount: number;
  note?: string;
}

export interface PayoutsTable {
  src: SrcRef;
  hidden: boolean;
  headerRow: number;
  rows: PayoutRow[];
  /** Số dòng có số tiền nhưng không có mã KG. */
  noCode: number;
  textNumbers: TextNumber[];
}

// ------------------------------------------------------------------ sổ thu chi

/** Một khoản tiền trong sổ thu chi kèm ngày của chính dòng chứa nó (dòng có thể được gộp vào dòng số dư kế tiếp). */
export interface LedgerFlow {
  field: "received" | "paid" | "salary" | "utilities" | "purchases" | "otherExpense" | "refund";
  value: number;
  date?: string;
  /** Số hàng trong sheet (1-based) và địa chỉ ô. */
  row: number;
  addr: string;
}

export interface LedgerRow {
  row: number;
  date?: string;
  /** Các khoản của dòng này theo từng ô, gồm cả khoản nằm ở dòng trước chưa có số dư. */
  flows: LedgerFlow[];
  received: number;
  paid: number;
  salary: number;
  utilities: number;
  purchases: number;
  otherExpense: number;
  refund: number;
  balance?: number;
  balanceFormula?: string;
  /** Các ô chi/nhận của dòng này không nằm trong công thức số dư. */
  omittedFromFormula: string[];
  /** Công thức số dư tham chiếu tới hàng khác hàng này và hàng trước. */
  foreignRefs: string[];
  note?: string;
}

export interface LedgerTable {
  src: SrcRef;
  hidden: boolean;
  headerRow: number;
  opening?: { row: number; date?: string; balance: number };
  rows: LedgerRow[];
  /** Dòng có số tiền nhưng không có số dư: ô nháp nằm ngoài sổ. */
  orphans: { row: number; addr: string; value: number; formula?: string; field: string }[];
  textNumbers: TextNumber[];
}

// ------------------------------------------------------------------ tổng hợp trả khách theo ngày

export interface DaySummaryRow {
  row: number;
  date: string;
  /** Trả cho lô của đợt hiện tại (đồng). */
  current: number;
  /** Trả cho lô của các đợt cũ (đồng). */
  previous: number;
}

export interface DaySummaryTable {
  src: SrcRef;
  hidden: boolean;
  headerRow: number;
  /** Nhãn cột đợt, ví dụ "926". */
  batch: string;
  rows: DaySummaryRow[];
  declared: DeclaredCell[];
}

// ------------------------------------------------------------------ doanh thu ngày

export interface RevenueRow {
  row: number;
  date: string;
  revenue: number;
  offline: number;
  online: number;
  expense: number;
  transfer: number;
  discount: number;
  cash: number;
}

export interface RevenueTable {
  src: SrcRef;
  hidden: boolean;
  headerRow: number;
  year: number;
  month: number;
  rows: RevenueRow[];
  /** Số dòng của tháng sau nằm ở cuối tab. */
  spill: number;
  /** Cột chi phí/tiền mặt vừa có số nhỏ (nghìn đồng) vừa có số lớn (đồng). */
  unitMixed: boolean;
  declared: DeclaredCell[];
}

// ------------------------------------------------------------------ báo cáo tháng

export interface MonthlyRow {
  row: number;
  month: number;
  revenue?: number;
  owed?: number;
  received?: number;
  paid?: number;
  expense?: number;
  refund?: number;
  left?: number;
  /** Công thức của ô "còn lại" nếu có. */
  leftFormula?: string;
  /** Các ô của dòng này là công thức (không phải gõ tay). */
  formulaCells: string[];
}

export interface MonthlyTable {
  src: SrcRef;
  hidden: boolean;
  headerRow: number;
  rows: MonthlyRow[];
}

// ------------------------------------------------------------------ dữ liệu xuất từ hệ thống quản lý

export interface GaOrder {
  row: number;
  key: string;
  code: string;
  batch: string;
  created?: string;
  qty: number;
  sold: number;
  /** Số tiền phải trả khách (đồng). */
  owed: number;
  method: "transfer" | "direct" | "other";
  status: "paid" | "unpaid" | "other";
  paidAt?: string;
  due?: string;
  /** Đơn thử nghiệm của hệ thống. */
  test: boolean;
}

export interface GaMonth {
  label: string;
  year: number;
  month: number;
  orders: number;
  products: number;
  sold: number;
  totalValue: number;
  owed: number;
  paid: number;
  unpaid: number;
}

export interface GaOverview {
  src: SrcRef;
  /** Thời điểm xuất báo cáo (cũng là thời điểm chụp trạng thái thanh toán). */
  exportedAt?: string;
  rangeFrom?: string;
  rangeTo?: string;
  totals: Partial<{ orders: number; products: number; totalValue: number; owed: number; paid: number; unpaid: number; ordersPaid: number; ordersUnpaid: number }>;
  months: GaMonth[];
}

export interface GaOrders {
  src: SrcRef;
  hidden: boolean;
  orders: GaOrder[];
  /** Số đơn không đọc được mã lô (không có chỗ gắn với lô). */
  unparsed: number;
  testOrders: number;
  /** Tổng "phải trả" của các đơn thử nghiệm (hệ thống vẫn tính chúng vào tổng quan). */
  testOwed: number;
}

// ------------------------------------------------------------------ gộp theo file

export interface ShopTab {
  sheet: string;
  kind: ShopTableKind;
  hidden: boolean;
  rows: number;
  via: "rules" | "ai";
  /** Lý do tab được nhận diện nhưng không đưa vào đối chiếu (ví dụ không xác định được tháng/năm). */
  note?: string;
  /** Hàng bị ẩn mà vẫn có dữ liệu (số hàng 1-based). */
  hiddenRows?: number[];
  /** Cột bị ẩn mà vẫn có dữ liệu và là cột mà bộ trích xuất đang đọc (chữ cái cột). */
  hiddenCols?: string[];
}

/**
 * Hồ sơ một cột của tab chưa nhận diện. Cố ý KHÔNG chứa giá trị ô: dữ liệu khách (tên, số điện thoại,
 * số tài khoản) có thể nằm ở đó. Chỉ có nhãn tiêu đề, thống kê và mẫu hình ký tự.
 */
export interface ColumnProfile {
  /** Chỉ số cột (0-based) và chữ cái cột. */
  col: number;
  letter: string;
  /** Nhãn ở hàng tiêu đề đoán được (đã che dãy số dài), rỗng nếu không có. */
  header: string;
  /** Số ô có dữ liệu trong phần lấy mẫu. */
  filled: number;
  /** Số ô là số (kể cả số lưu dạng chữ). */
  numeric: number;
  /** Số ô là ngày. */
  dates: number;
  /** Nhỏ nhất / lớn nhất của các ô số, làm tròn 2 chữ số có nghĩa (chỉ để biết cỡ số, không lộ số gốc). */
  min?: number;
  max?: number;
  /** Cột toàn số nguyên dài, không lặp: giống số tài khoản/điện thoại/CMND nên không công bố phạm vi giá trị. */
  idLike?: boolean;
  /** Mẫu hình của ô chữ (A hoa, a thường, 9 chữ số; dãy dài ghi "+"), tối đa 3 mẫu phổ biến nhất. */
  patterns: { p: string; n: number }[];
}

/** Tab chưa nhận diện được: chỉ giữ hồ sơ cấu trúc để người dùng xem hoặc đưa cho AI đề xuất bố cục. */
export interface UnknownTab {
  sheet: string;
  hidden: boolean;
  /** Số hàng có dữ liệu (đếm trong giới hạn). */
  rows: number;
  cols: number;
  /** Hàng tiêu đề đoán được (0-based). */
  headerRow?: number;
  columns: ColumnProfile[];
}

export interface ShopFileData {
  tabs: ShopTab[];
  unknown: UnknownTab[];
  lots: LotsTable[];
  payouts: PayoutsTable[];
  ledgers: LedgerTable[];
  daySummaries: DaySummaryTable[];
  revenues: RevenueTable[];
  monthly: MonthlyTable[];
  gaOrders: GaOrders[];
  gaOverview: GaOverview[];
}

// ------------------------------------------------------------------ kết quả kiểm tiền (gửi về giao diện)

export type CheckStatus = "ok" | "issue" | "na";

/** Một phép kiểm: kết quả chung và kết quả theo từng tháng của năm kiểm. */
export interface ShopCheck {
  id: string;
  group: "lots" | "system" | "ledger" | "bank" | "report" | "revenue";
  label: string;
  status: CheckStatus;
  /** Số mục lệch (dòng, lô, ngày hoặc tháng tùy phép kiểm). */
  issues: number;
  /** Tổng số tiền của các mục lệch (đồng). */
  amount: number;
  /** Một câu tóm tắt kết quả, ví dụ "2.015/2.019 lô khớp". */
  detail: string;
  /** Kết quả theo tháng 1..12; tháng không có dữ liệu để kiểm thì không có khóa. */
  months: Record<number, { status: CheckStatus; issues: number; amount: number }>;
}

/** Một dòng số liệu theo tháng lấy từ một nguồn, để người xem đặt cạnh nhau. */
export interface ShopFigure {
  id: string;
  label: string;
  source: string;
  months: Record<number, number>;
}

export interface ShopCoverageItem {
  kind: "statement" | "table" | "tab" | "duplicate" | "info";
  level: "warn" | "info";
  label: string;
  detail?: string;
}

/** Một loại bảng nghiệp vụ đã nhận diện trong một file: có bao nhiêu tab, bao nhiêu tab đang ẩn, tổng bao nhiêu dòng. */
export interface ShopTabGroup {
  kind: ShopTableKind;
  label: string;
  count: number;
  hidden: number;
  rows: number;
}

export interface ShopSourceSummary {
  fileId: string;
  fileName: string;
  tabs: ShopTabGroup[];
  unknownTabs: { sheet: string; hidden: boolean; rows: number; headers: string[] }[];
}

export interface ShopSummary {
  year: number;
  from: string;
  /** Ngày muộn nhất có dữ liệu giao dịch (chuyển khoản, sao kê). */
  asOf: string;
  sources: ShopSourceSummary[];
  figures: ShopFigure[];
  checks: ShopCheck[];
  coverage: ShopCoverageItem[];
}

export function emptyShopData(): ShopFileData {
  return { tabs: [], unknown: [], lots: [], payouts: [], ledgers: [], daySummaries: [], revenues: [], monthly: [], gaOrders: [], gaOverview: [] };
}

export function hasShopData(d: ShopFileData | undefined): boolean {
  return !!d && d.tabs.length > 0;
}
