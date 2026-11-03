// Nhận diện cột của bảng dữ liệu kế toán: tiêu đề tiếng Việt/Anh, tiêu đề 2 hàng, suy luận khi không có tiêu đề.

import { containsPhrase, normText } from "@/lib/util/text";
import {
  type Cell,
  type DateOrder,
  cellText,
  isDateCell,
  isEmptyCell,
  isProseCell,
  parseDate,
  parseNumber,
  startsWithDate,
} from "@/lib/util/values";

export type Field =
  | "date"
  | "description"
  | "counterparty"
  | "taxCode"
  | "reference"
  | "series"
  | "debit"
  | "credit"
  | "amount"
  | "net"
  | "tax"
  | "balance"
  | "balanceDebit"
  | "balanceCredit"
  | "account";

interface FieldDef {
  field: Field;
  /** Tiêu đề phải bằng đúng cụm này (đã bỏ dấu). */
  exact: string[];
  /** Tiêu đề chứa nguyên cụm này. */
  phrase: string[];
  /** Chỉ dùng khi không có ứng viên tốt hơn. */
  weak?: string[];
}

const DEFS: FieldDef[] = [
  {
    field: "account",
    exact: ["tk", "tai khoan", "account", "acct", "stk", "so tk", "so tai khoan"],
    phrase: [
      "tk no",
      "tk co",
      "tai khoan no",
      "tai khoan co",
      "tk doi ung",
      "tai khoan doi ung",
      "tk ghi no",
      "tk ghi co",
      "tai khoan ghi no",
      "tai khoan ghi co",
      "so tai khoan",
      "so tk",
      "account number",
      "account no",
      "gl account",
      "ma tai khoan",
      "ma tk",
      "tk du",
    ],
  },
  {
    field: "date",
    exact: ["ngay", "date", "ngay gd", "ngay ct", "ngay hd", "ngay hl", "ngay tt", "thoi gian", "time", "ngay thang"],
    phrase: [
      "ngay giao dich",
      "ngay chung tu",
      "ngay hach toan",
      "ngay hoa don",
      "ngay lap",
      "ngay ghi so",
      "ngay thang",
      "ngay hieu luc",
      "ngay phat hanh",
      "ngay phat sinh",
      "ngay thanh toan",
      "ngay gio",
      "transaction date",
      "trans date",
      "tran date",
      "posting date",
      "value date",
      "booking date",
      "document date",
      "invoice date",
      "entry date",
    ],
  },
  {
    field: "description",
    exact: [
      "dien giai",
      "noi dung",
      "mo ta",
      "description",
      "details",
      "detail",
      "narrative",
      "memo",
      "particulars",
      "noi dung giao dich",
      "transaction details",
      "noi dung chi tiet",
      "dien giai chi tiet",
    ],
    phrase: ["dien giai", "noi dung", "mo ta", "description", "narrative", "particulars", "memo", "transaction details"],
    weak: ["ghi chu", "note", "notes", "remark", "remarks", "ly do"],
  },
  {
    field: "counterparty",
    exact: [
      "doi tuong",
      "doi tac",
      "khach hang",
      "nha cung cap",
      "ncc",
      "payee",
      "beneficiary",
      "counterparty",
      "vendor",
      "supplier",
      "customer",
      "nguoi nhan",
      "nguoi gui",
      "ten kh",
      "ten ncc",
      "ten",
      "name",
      "ben thu huong",
      "nguoi thu huong",
      "ten don vi",
      "don vi",
      "nguoi ban",
      "nguoi mua",
      "khach",
    ],
    phrase: [
      "ten doi tuong",
      "ten doi tac",
      "ten khach hang",
      "ten nha cung cap",
      "ten ncc",
      "ten nguoi ban",
      "ten nguoi mua",
      "nguoi ban",
      "nguoi mua",
      "don vi ban",
      "don vi mua",
      "ten don vi",
      "nguoi thu huong",
      "ben thu huong",
      "ten nguoi thu huong",
      "ten nguoi nhan",
      "ten nguoi chuyen",
      "nguoi chuyen",
      "doi tuong",
      "khach hang",
      "nha cung cap",
      "beneficiary name",
      "payee name",
      "customer name",
      "vendor name",
      "supplier name",
      "counterparty name",
      "ten cong ty",
      "ten tai khoan",
    ],
  },
  {
    field: "taxCode",
    exact: ["mst", "tax code", "tax id", "tin", "ma so thue"],
    phrase: [
      "ma so thue",
      "ma so thue nguoi ban",
      "ma so thue nguoi mua",
      "mst nguoi ban",
      "mst nguoi mua",
      "mst doi tuong",
      "mst khach hang",
      "mst doi tac",
      "mst ncc",
      "mst don vi",
      "mst",
      "tax code",
      "tax id",
      "tax number",
      "tax registration",
    ],
  },
  {
    field: "reference",
    exact: [
      "so",
      "so ct",
      "so hd",
      "so phieu",
      "ref",
      "reference",
      "ref no",
      "doc no",
      "voucher",
      "voucher no",
      "invoice no",
      "invoice number",
      "invoice",
      "so hieu",
      "so chung tu",
      "so hoa don",
      "ma gd",
      "ma giao dich",
      "trans id",
      "transaction id",
      "txn id",
      "so tham chieu",
      "so unc",
      "so lenh",
      "so but toan",
      "chung tu",
      "ma chung tu",
    ],
    phrase: [
      "so chung tu",
      "so hoa don",
      "so hieu",
      "ma giao dich",
      "so tham chieu",
      "so but toan",
      "so phieu",
      "so unc",
      "so uy nhiem chi",
      "so lenh",
      "chung tu so",
      "hoa don so",
      "reference",
      "invoice no",
      "invoice number",
      "document no",
      "document number",
      "voucher no",
      "transaction id",
      "transaction ref",
      "so ct",
      "so hd",
      "ma gd",
      "ma chung tu",
      "ref no",
    ],
  },
  {
    field: "series",
    exact: ["ky hieu", "series", "ky hieu hd", "ky hieu hoa don", "mau so ky hieu"],
    phrase: ["ky hieu hoa don", "ky hieu hd", "serial", "series"],
  },
  {
    field: "debit",
    exact: [
      "no",
      "debit",
      "dr",
      "ghi no",
      "rut ra",
      "chi",
      "tien ra",
      "withdrawal",
      "withdrawals",
      "debit amount",
      "ps no",
      "phat sinh no",
      "tien chi",
      "chi ra",
      "paid out",
      "money out",
      "so tien no",
      "so tien ghi no",
      "debits",
    ],
    phrase: [
      "ghi no",
      "phat sinh no",
      "so tien no",
      "so tien ghi no",
      "debit",
      "rut ra",
      "withdrawal",
      "tien chi",
      "so tien chi",
      "money out",
      "paid out",
      "ps no",
      "tien ra",
      "doanh so no",
    ],
  },
  {
    field: "credit",
    exact: [
      "co",
      "credit",
      "cr",
      "ghi co",
      "gui vao",
      "thu",
      "tien vao",
      "deposit",
      "deposits",
      "credit amount",
      "ps co",
      "phat sinh co",
      "tien thu",
      "paid in",
      "money in",
      "so tien co",
      "so tien ghi co",
      "credits",
    ],
    phrase: [
      "ghi co",
      "phat sinh co",
      "so tien co",
      "so tien ghi co",
      "credit",
      "gui vao",
      "deposit",
      "tien thu",
      "so tien thu",
      "money in",
      "paid in",
      "ps co",
      "tien vao",
      "doanh so co",
    ],
  },
  {
    field: "amount",
    exact: [
      "so tien",
      "amount",
      "gia tri",
      "thanh tien",
      "tien",
      "tong tien",
      "value",
      "tong cong",
      "total",
      "so tien vnd",
      "so tien giao dich",
      "amount vnd",
      "gia tri giao dich",
      "gia tri hoa don",
      "tong gia tri",
      "tong thanh toan",
      "tong tien thanh toan",
      "tong so tien",
    ],
    phrase: [
      "so tien",
      "gia tri hoa don",
      "gia tri giao dich",
      "tong tien thanh toan",
      "tong thanh toan",
      "tong gia tri thanh toan",
      "tong gia tri",
      "tong tien",
      "tong cong tien thanh toan",
      "tong cong",
      "thanh tien",
      "amount",
      "tong so tien",
      "transaction amount",
      "trans amount",
      "total amount",
      "invoice amount",
      "gia tri",
    ],
  },
  {
    field: "net",
    exact: [
      "net",
      "net amount",
      "chua thue",
      "truoc thue",
      "tien hang",
      "tien chua thue",
      "gia tri chua thue",
      "doanh so chua thue",
      "thanh tien chua thue",
      "doanh thu",
    ],
    phrase: [
      "chua thue",
      "chua co thue",
      "truoc thue",
      "tien hang",
      "net amount",
      "subtotal",
      "sub total",
      "cong tien hang",
      "doanh so chua thue",
      "gia tri chua thue",
      "doanh thu chua thue",
      "thanh tien chua thue",
      "tong tien chua thue",
      "tien chua thue",
      "gia chua thue",
      "doanh so ban chua co thue",
      "doanh so mua chua co thue",
    ],
  },
  {
    field: "tax",
    exact: ["thue", "vat", "tax", "gtgt", "thue gtgt", "tien thue", "vat amount", "tax amount"],
    phrase: ["tien thue", "thue gtgt", "vat amount", "tax amount", "tien vat", "thue vat", "so tien thue", "thue gia tri gia tang"],
  },
  {
    field: "balance",
    exact: [
      "so du",
      "balance",
      "du cuoi",
      "closing balance",
      "running balance",
      "so du cuoi ky",
      "available balance",
      "so du sau gd",
      "so du tk",
      "so du cuoi",
    ],
    phrase: ["so du", "balance", "du cuoi", "so du cuoi", "so du sau"],
  },
  {
    field: "balanceDebit",
    exact: ["so du no", "du no", "du no cuoi ky", "so du no cuoi ky"],
    phrase: ["so du no", "du no cuoi", "balance debit"],
  },
  {
    field: "balanceCredit",
    exact: ["so du co", "du co", "du co cuoi ky", "so du co cuoi ky"],
    phrase: ["so du co", "du co cuoi", "balance credit"],
  },
];

const MONEY_FIELDS: Field[] = ["debit", "credit", "amount", "net"];
const NUMERIC_FIELDS: Field[] = [
  "debit",
  "credit",
  "amount",
  "net",
  "tax",
  "balance",
  "balanceDebit",
  "balanceCredit",
];

/** Nhãn của dòng tổng cộng / số dư cuối bảng (song ngữ Việt-Anh như sao kê Vietcombank). */
export const FOOTER_ROW_RE =
  /^(tổng cộng|tổng số|tổng|cộng phát sinh|total|số dư cuối|số dư đầu|closing balance|opening balance|trân trọng|ghi chú|note)(?![\p{L}\p{N}])/iu;

export interface HeaderMatch {
  field: Field;
  score: number;
}

export function matchHeader(label: string): HeaderMatch | null {
  const n = normText(label);
  if (!n) return null;
  let best: HeaderMatch | null = null;
  const consider = (field: Field, score: number) => {
    if (!best || score > best.score) best = { field, score };
  };
  for (const def of DEFS) {
    if (def.exact.includes(n)) consider(def.field, 1000 + n.length);
    for (const p of def.phrase) if (containsPhrase(n, p)) consider(def.field, 100 + p.length);
    if (def.weak) for (const p of def.weak) if (containsPhrase(n, p)) consider(def.field, p.length);
  }
  return best;
}

export interface ColumnMap {
  /** Chỉ số hàng tiêu đề (đầu tiên); -1 nếu suy luận không có tiêu đề. */
  headerRow: number;
  dataStart: number;
  cols: Partial<Record<Field, number>>;
  labels: string[];
  inferred: boolean;
}

function pickColumns(matches: (HeaderMatch | null)[]): Partial<Record<Field, number>> {
  const cols: Partial<Record<Field, number>> = {};
  const scores: Partial<Record<Field, number>> = {};
  matches.forEach((m, c) => {
    if (!m) return;
    if (scores[m.field] === undefined || m.score > (scores[m.field] as number)) {
      cols[m.field] = c;
      scores[m.field] = m.score;
    }
  });
  return cols;
}

export interface Evaluated {
  cols: Partial<Record<Field, number>>;
  labels: string[];
  distinct: number;
}

export function evaluateLabels(labels: string[]): Evaluated | null {
  const matches = labels.map((l) => (l && l.length <= 60 ? matchHeader(l) : null));
  const cols = pickColumns(matches);
  const fields = Object.keys(cols) as Field[];
  const hasMoney = MONEY_FIELDS.some((f) => cols[f] !== undefined);
  if (fields.length < 2 || !hasMoney) return null;
  return { cols, labels, distinct: fields.length };
}

function isSubHeaderRow(row: Cell[]): boolean {
  let nonEmpty = 0;
  let matched = 0;
  for (const c of row) {
    if (isEmptyCell(c)) continue;
    nonEmpty++;
    if (typeof c !== "string") return false;
    const t = cellText(c);
    if (t.length > 40) return false;
    if (parseNumber(t) !== null || parseDate(t) !== null) return false;
    if (matchHeader(t)) matched++;
  }
  return nonEmpty > 0 && matched > 0;
}

function combineLabels(top: Cell[], sub: Cell[]): string[] {
  const width = Math.max(top.length, sub.length);
  const out: string[] = [];
  for (let c = 0; c < width; c++) {
    const a = cellText(top[c]);
    const b = cellText(sub[c]);
    if (a && b && normText(a) !== normText(b)) out.push(`${a} ${b}`);
    else out.push(a || b);
  }
  return out;
}

/** Tìm hàng tiêu đề tốt nhất trong ~40 hàng đầu (hỗ trợ tiêu đề 2 hàng). */
export function detectColumns(rows: Cell[][], maxScan = 40): ColumnMap | null {
  const limit = Math.min(maxScan, rows.length);
  let best: (Evaluated & { headerRow: number; dataStart: number }) | null = null;
  for (let r = 0; r < limit; r++) {
    const row = rows[r];
    if (!row || row.every(isEmptyCell)) continue;
    const single = evaluateLabels(row.map(cellText));
    let cand = single ? { ...single, headerRow: r, dataStart: r + 1 } : null;
    const next = rows[r + 1];
    if (next && isSubHeaderRow(next)) {
      const combined = evaluateLabels(combineLabels(row, next));
      if (combined && (!cand || combined.distinct > cand.distinct)) {
        cand = { ...combined, headerRow: r, dataStart: r + 2 };
      }
    }
    if (cand && (!best || cand.distinct > best.distinct)) best = cand;
  }
  if (!best) return null;
  return { headerRow: best.headerRow, dataStart: best.dataStart, cols: best.cols, labels: best.labels, inferred: false };
}

/** Bỏ ánh xạ cột nếu nội dung không đúng kiểu (ví dụ cột "Thứ" bị nhận là "Thu"). */
export function validateColumns(rows: Cell[][], map: ColumnMap, order: DateOrder): ColumnMap | null {
  const sample = rows.slice(map.dataStart, map.dataStart + 300);
  const cols: Partial<Record<Field, number>> = { ...map.cols };
  for (const f of NUMERIC_FIELDS) {
    const c = cols[f];
    if (c === undefined) continue;
    let nonEmpty = 0;
    let numeric = 0;
    for (const r of sample) {
      const cell = r[c];
      // Ô chữ dài kiểu câu là chân trang/ghi chú, không phải giá trị của cột.
      if (isEmptyCell(cell) || isProseCell(cell)) continue;
      nonEmpty++;
      if (parseNumber(cell) !== null) numeric++;
    }
    if (nonEmpty > 0 && numeric / nonEmpty < 0.5) delete cols[f];
  }
  const dc = cols.date;
  if (dc !== undefined) {
    let nonEmpty = 0;
    let dates = 0;
    for (const r of sample) {
      const cell = r[dc];
      if (isEmptyCell(cell) || isProseCell(cell)) continue;
      nonEmpty++;
      if (isDateCell(cell) || (typeof cell === "string" && parseDate(cell, order) !== null)) dates++;
    }
    if (nonEmpty > 0 && dates / nonEmpty < 0.5) delete cols.date;
  }
  if (!MONEY_FIELDS.some((f) => cols[f] !== undefined)) return null;
  return { ...map, cols };
}

/**
 * Sao kê một số ngân hàng (Vietcombank) đặt ngày và số chứng từ chung một ô ("25/02/2026\n9701 - 1353575663")
 * dưới tiêu đề "Ngày / Số CT". Tiêu đề khớp "số chứng từ" nên cột bị nhận là chứng từ, mất ngày.
 * Nếu hầu hết giá trị của cột chứng từ bắt đầu bằng ngày thì dùng cột đó làm cột ngày luôn.
 */
export function promoteCombinedDate(rows: Cell[][], map: ColumnMap): ColumnMap {
  if (map.cols.date !== undefined || map.cols.reference === undefined) return map;
  const c = map.cols.reference;
  let nonEmpty = 0;
  let dated = 0;
  for (const r of rows.slice(map.dataStart, map.dataStart + 300)) {
    // Dừng ở dòng tổng/số dư đầu tiên: phần sau là chân trang, không phải giao dịch.
    if (r.some((x) => typeof x === "string" && FOOTER_ROW_RE.test(x.trim()))) break;
    const cell = r[c];
    if (isEmptyCell(cell) || isProseCell(cell)) continue;
    nonEmpty++;
    if (startsWithDate(cell)) dated++;
  }
  if (nonEmpty === 0 || dated / nonEmpty < 0.8) return map;
  return { ...map, cols: { ...map.cols, date: c } };
}

// ---------------------------------------------------------------- suy luận khi không có tiêu đề

interface ColumnProfile {
  n: number;
  dates: number;
  nums: number;
  textLen: number;
  texts: number;
  withDigits: number;
  values: number[];
}

/** Bảng không có tiêu đề: đoán cột theo nội dung. Kết quả chỉ mang tính gợi ý. */
export function inferColumns(rows: Cell[][], order: DateOrder): ColumnMap | null {
  const sample = rows.slice(0, 400).filter((r) => r.some((c) => !isEmptyCell(c)));
  if (sample.length < 3) return null;
  const width = Math.max(...sample.map((r) => r.length));
  const profiles: ColumnProfile[] = Array.from({ length: width }, () => ({
    n: 0,
    dates: 0,
    nums: 0,
    textLen: 0,
    texts: 0,
    withDigits: 0,
    values: [],
  }));

  for (const r of sample) {
    for (let c = 0; c < width; c++) {
      const cell = r[c];
      const t = cellText(cell);
      if (!t) continue;
      const p = profiles[c];
      p.n++;
      if (isDateCell(cell) || (typeof cell === "string" && parseDate(cell, order) !== null)) {
        p.dates++;
      } else {
        const num = parseNumber(cell);
        if (num !== null) {
          p.nums++;
          p.values.push(num);
        } else {
          p.texts++;
          p.textLen += t.length;
          if (/\d/.test(t)) p.withDigits++;
        }
      }
    }
  }

  const dateCol = profiles.findIndex((p) => p.n >= 3 && p.dates / p.n >= 0.6);

  const isSerialColumn = (p: ColumnProfile): boolean => {
    if (p.values.length < 3) return false;
    if (!p.values.every((v) => Number.isInteger(v) && v >= 0 && v < 100000)) return false;
    let inc = 0;
    for (let i = 1; i < p.values.length; i++) if (p.values[i] === p.values[i - 1] + 1) inc++;
    return inc / (p.values.length - 1) >= 0.7;
  };

  const numCols: number[] = [];
  profiles.forEach((p, c) => {
    if (c === dateCol) return;
    if (p.n >= 3 && p.nums / p.n >= 0.6 && !isSerialColumn(p)) numCols.push(c);
  });
  if (numCols.length === 0) return null;

  const cols: Partial<Record<Field, number>> = {};
  if (dateCol >= 0) cols.date = dateCol;

  let descCol = -1;
  let descAvg = 0;
  profiles.forEach((p, c) => {
    if (c === dateCol || numCols.includes(c) || p.texts < 3) return;
    const avg = p.textLen / p.texts;
    if (avg > descAvg) {
      descAvg = avg;
      descCol = c;
    }
  });
  if (descCol >= 0 && descAvg >= 6) cols.description = descCol;

  profiles.forEach((p, c) => {
    if (cols.reference !== undefined) return;
    if (c === dateCol || c === descCol || numCols.includes(c) || p.texts < 3) return;
    const avg = p.textLen / p.texts;
    if (avg >= 3 && avg <= 24 && p.withDigits / p.texts >= 0.5) cols.reference = c;
  });

  const pairRelation = (a: number, b: number): number => {
    // tỷ lệ dòng mà |Δ cột b| bằng |cột a|, tức b là số dư lũy kế của a
    let tested = 0;
    let ok = 0;
    let prev: number | null = null;
    for (const r of sample) {
      const av = parseNumber(r[a]);
      const bv = parseNumber(r[b]);
      if (bv === null) continue;
      if (prev !== null && av !== null) {
        tested++;
        if (Math.abs(Math.abs(bv - prev) - Math.abs(av)) < 0.5) ok++;
      }
      prev = bv;
    }
    return tested >= 3 ? ok / tested : 0;
  };

  const exclusive = (a: number, b: number): boolean => {
    let both = 0;
    let any = 0;
    for (const r of sample) {
      const ha = !isEmptyCell(r[a]) && parseNumber(r[a]) !== null;
      const hb = !isEmptyCell(r[b]) && parseNumber(r[b]) !== null;
      if (ha || hb) any++;
      if (ha && hb) both++;
    }
    return any > 0 && both / any <= 0.1;
  };

  if (numCols.length === 1) {
    cols.amount = numCols[0];
  } else if (numCols.length === 2) {
    const [a, b] = numCols;
    if (pairRelation(a, b) >= 0.5) {
      cols.amount = a;
      cols.balance = b;
    } else if (exclusive(a, b)) {
      cols.debit = a;
      cols.credit = b;
    } else {
      cols.amount = a;
    }
  } else {
    const a = numCols[0];
    const b = numCols[1];
    const last = numCols[numCols.length - 1];
    if (exclusive(a, b)) {
      cols.debit = a;
      cols.credit = b;
      if (pairRelation(a, last) >= 0.4 || pairRelation(b, last) >= 0.4) cols.balance = last;
    } else {
      cols.amount = a;
      if (pairRelation(a, last) >= 0.4) cols.balance = last;
    }
  }

  return { headerRow: -1, dataStart: 0, cols, labels: [], inferred: true };
}
