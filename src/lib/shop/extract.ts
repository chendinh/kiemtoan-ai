// Trích xuất các bảng nghiệp vụ của shop từ một Grid đã được nhận diện bố cục.
// Chỉ lấy các trường phục vụ kiểm tiền. Không đọc tên, số điện thoại, CMND, email, số tài khoản của khách.

import { normText } from "@/lib/util/text";
import { parseDate } from "@/lib/util/values";
import { SHOP, cleanNote, toVnd } from "./config";
import { Grid, formulaRefs, parseSumRange } from "./grid";
import { lotKey, normCode, parseGaKey } from "./keys";
import type {
  DaySummaryRow,
  DaySummaryTable,
  DeclaredCell,
  GaMonth,
  GaOrder,
  GaOrders,
  GaOverview,
  Layout,
  LedgerFlow,
  LedgerRow,
  LedgerTable,
  LotRow,
  LotsTable,
  MonthlyRow,
  MonthlyTable,
  PayoutRow,
  PayoutsTable,
  RevenueRow,
  RevenueTable,
  SrcRef,
  TextNumber,
} from "./types";

// ------------------------------------------------------------------ tiện ích

function declared(g: Grid, r: number, c: number, field: string): DeclaredCell | null {
  const info = g.numInfo(r, c);
  if (!info) return null;
  const formula = g.formula(r, c);
  return { field, addr: g.addr(r, c), row: r + 1, value: info.value, formula, range: parseSumRange(formula) };
}

function noteOf(g: Grid, r: number, c: number | undefined): string | undefined {
  if (c === undefined) return undefined;
  const t = g.text(r, c);
  return t ? cleanNote(t) : undefined;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const pad2 = (n: number) => String(n).padStart(2, "0");

// ------------------------------------------------------------------ bảng ký gửi theo lô

export function extractLots(g: Grid, layout: Layout, src: SrcRef): LotsTable {
  const c = layout.cols;
  const rows: LotRow[] = [];
  const decl: DeclaredCell[] = [];
  const textNumbers: TextNumber[] = [];
  const fields: [string, number | undefined][] = [
    ["owed", c.owed],
    ["qtyIn", c.qtyIn],
    ["qtySold", c.qtySold],
    ["left", c.left],
  ];

  for (let r = 0; r <= g.r1; r++) {
    if (r === layout.headerRow) continue;
    const codeText = g.text(r, c.code);
    const batchText = g.text(r, c.batch);
    const nCode = normText(codeText);
    const isLabelRow = nCode === "ma kg" || normText(g.text(r, c.code - 1)) === "sdt";
    const owedInfo = c.owed !== undefined ? g.numInfo(r, c.owed) : null;
    const qtyInfo = c.qtyIn !== undefined ? g.numInfo(r, c.qtyIn) : null;
    const isLot = !isLabelRow && codeText !== "" && batchText !== "" && (owedInfo !== null || qtyInfo !== null);

    if (!isLot) {
      // Hàng nhãn / hàng tổng: ghi nhận các ô tổng (gõ tay hoặc công thức).
      for (const [field, col] of fields) {
        if (col === undefined) continue;
        const d = declared(g, r, col, field);
        if (d) decl.push(d);
      }
      continue;
    }

    const code = normCode(codeText);
    const batch = batchText;
    if (owedInfo?.text) textNumbers.push({ addr: g.addr(r, c.owed), text: g.text(r, c.owed), field: "owed" });
    const soldInfo = c.qtySold !== undefined ? g.numInfo(r, c.qtySold) : null;
    if (soldInfo?.text) textNumbers.push({ addr: g.addr(r, c.qtySold), text: g.text(r, c.qtySold), field: "qtySold" });
    const ck = c.ckDate !== undefined ? g.date(r, c.ckDate) : null;
    rows.push({
      row: r + 1,
      code,
      batch,
      key: lotKey(code, batch),
      qtyIn: qtyInfo?.value ?? 0,
      qtySold: soldInfo?.value ?? 0,
      owed: (owedInfo?.value ?? 0) * SHOP.unit.lots,
      ckDate: ck ?? undefined,
      note: noteOf(g, r, c.note),
    });
  }

  const freq = new Map<string, number>();
  for (const l of rows) freq.set(l.batch, (freq.get(l.batch) ?? 0) + 1);
  const mainBatch = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return { src, hidden: g.hidden, headerRow: layout.headerRow, mainBatch, rows, declared: decl, textNumbers };
}

// ------------------------------------------------------------------ danh sách chuyển khoản

export function extractPayouts(g: Grid, layout: Layout, src: SrcRef): PayoutsTable {
  const c = layout.cols;
  const rows: PayoutRow[] = [];
  const textNumbers: TextNumber[] = [];
  let noCode = 0;
  let curDate: string | undefined;

  for (let r = layout.headerRow + 1; r <= g.r1; r++) {
    const d = c.date !== undefined ? g.date(r, c.date) : null;
    if (d) curDate = d;
    const codeText = g.text(r, c.code);
    const info = g.numInfo(r, c.amount);
    if (!info) continue;
    if (codeText === "") {
      noCode++;
      continue;
    }
    if (info.text) textNumbers.push({ addr: g.addr(r, c.amount), text: g.text(r, c.amount), field: "amount" });
    const code = normCode(codeText);
    const batch = g.text(r, c.batch);
    rows.push({
      row: r + 1,
      date: curDate,
      code,
      batch,
      key: lotKey(code, batch),
      amount: info.value * SHOP.unit.payouts,
      note: noteOf(g, r, c.note),
    });
  }
  return { src, hidden: g.hidden, headerRow: layout.headerRow, rows, noCode, textNumbers };
}

// ------------------------------------------------------------------ sổ thu chi

const LEDGER_FLOW_FIELDS = ["received", "paid", "salary", "utilities", "purchases", "otherExpense", "refund"] as const;

export function extractLedger(g: Grid, layout: Layout, src: SrcRef): LedgerTable {
  const c = layout.cols;
  const rows: LedgerRow[] = [];
  const textNumbers: TextNumber[] = [];
  let opening: LedgerTable["opening"];
  let curDate: string | undefined;
  let prevSheetRow: number | undefined;

  type Flow = Record<(typeof LEDGER_FLOW_FIELDS)[number], number>;
  type FlowCell = { col: string; row: number; field: LedgerFlow["field"]; addr: string; value: number; date?: string };
  const zeroFlow = (): Flow => ({ received: 0, paid: 0, salary: 0, utilities: 0, purchases: 0, otherExpense: 0, refund: 0 });

  // Các dòng có số tiền mà chưa có số dư. Khi gặp dòng có số dư, chúng được gộp vào dòng đó
  // (ví dụ H6 = H2 - F3 - F4 - F5 + B3 - F6). Dòng còn sót cuối sổ là ô nháp ngoài sổ.
  let pending: FlowCell[] = [];

  /** Công thức số dư của dòng có số dư kế tiếp sau hàng `r`. */
  const nextBalanceFormula = (r: number): string | undefined => {
    for (let rr = r + 1; rr <= g.r1; rr++) if (g.numInfo(rr, c.balance)) return g.formula(rr, c.balance);
    return undefined;
  };

  for (let r = layout.headerRow + 1; r <= g.r1; r++) {
    const d = c.date !== undefined ? g.date(r, c.date) : null;
    if (d) curDate = d;

    const cells: FlowCell[] = [];
    for (const f of LEDGER_FLOW_FIELDS) {
      const col = c[f];
      if (col === undefined) continue;
      const info = g.numInfo(r, col);
      if (!info) continue;
      if (info.text) textNumbers.push({ addr: g.addr(r, col), text: g.text(r, col), field: f });
      cells.push({ col: Grid.colLetter(col), row: r + 1, field: f, addr: g.addr(r, col), value: info.value, date: curDate });
    }
    const balInfo = g.numInfo(r, c.balance);

    if (cells.length === 0 && !balInfo) continue;
    if (!balInfo) {
      pending.push(...cells);
      continue;
    }

    const formula = g.formula(r, c.balance);
    const block = [...pending, ...cells];

    // Dòng chỉ có số dư và là dòng đầu tiên: số dư chuyển sang của kỳ.
    if (block.length === 0 && !opening && rows.length === 0) {
      opening = { row: r + 1, date: d ?? curDate, balance: balInfo.value };
      continue;
    }

    // Dòng đầu tiên có số dư gõ tay kèm tiền nhận/chi: số dư đó là số chuyển sang, còn tiền của chính dòng này được cộng
    // ở công thức của dòng số dư kế tiếp (H3 = H2 + B2 - C3 - G2). Chỉ áp dụng khi công thức kế tiếp thật sự nhắc tới các ô đó.
    if (!opening && rows.length === 0 && !formula && block.length > 0) {
      const next = nextBalanceFormula(r);
      const refs = next ? formulaRefs(next) : [];
      if (refs.some((x) => block.some((b) => b.col === x.col && b.row === x.row))) {
        opening = { row: r + 1, date: d ?? curDate, balance: balInfo.value };
        pending = block;
        continue;
      }
    }
    pending = [];

    const flow = zeroFlow();
    for (const b of block) flow[b.field] += b.value;

    // Công thức số dư phải nhắc tới đủ các ô chi/nhận của khối và chỉ trỏ vào hàng của khối hoặc số dư hàng trước.
    const omitted: string[] = [];
    const foreign: string[] = [];
    if (formula) {
      const refs = formulaRefs(formula);
      const blockRows = new Set(block.map((b) => b.row).concat(r + 1));
      for (const ref of refs) {
        const isPrevBalance = ref.row === prevSheetRow || (prevSheetRow === undefined && opening !== undefined && ref.row === opening.row);
        if (!blockRows.has(ref.row) && !isPrevBalance) foreign.push(ref.text);
      }
      for (const b of block) if (!refs.some((x) => x.col === b.col && x.row === b.row)) omitted.push(b.addr);
    }
    if (balInfo.text) textNumbers.push({ addr: g.addr(r, c.balance), text: g.text(r, c.balance), field: "balance" });

    rows.push({
      row: r + 1,
      date: curDate,
      flows: block.map((b) => ({ field: b.field, value: b.value, date: b.date, row: b.row, addr: b.addr })),
      ...flow,
      balance: balInfo.value,
      balanceFormula: formula ? (formula.length > 120 ? `${formula.slice(0, 119)}…` : formula) : undefined,
      omittedFromFormula: omitted,
      foreignRefs: foreign,
      note: noteOf(g, r, c.note),
    });
    prevSheetRow = r + 1;
  }

  const orphans: LedgerTable["orphans"] = pending.map((p) => ({
    row: p.row,
    addr: p.addr,
    value: p.value,
    formula: g.formula(p.row - 1, c[p.field]),
    field: p.field,
  }));
  return { src, hidden: g.hidden, headerRow: layout.headerRow, opening, rows, orphans, textNumbers };
}

// ------------------------------------------------------------------ tổng hợp trả khách theo ngày

export function extractDaySummary(g: Grid, layout: Layout, src: SrcRef): DaySummaryTable {
  const c = layout.cols;
  const rows: DaySummaryRow[] = [];
  const decl: DeclaredCell[] = [];
  const headerLabel = g.text(layout.headerRow, c.current);
  const batch = /(\d{3,4})$/.exec(headerLabel)?.[1] ?? "";
  let curDate: string | undefined;
  let seenDay = false;

  for (let r = layout.headerRow + 1; r <= g.r1; r++) {
    const d = g.date(r, c.date);
    const cur = g.numInfo(r, c.current);
    const prev = g.numInfo(r, c.previous);
    if (!cur && !prev) continue;
    const fCur = g.formula(r, c.current);
    const fPrev = g.formula(r, c.previous);
    const f = fCur ?? fPrev ?? "";
    // Ô tổng khai báo: hàng ngay dưới tiêu đề (trước mọi dòng ngày), hoặc hàng không ngày có công thức SUM / trừ ô khác.
    const isDeclared = !d && ((!seenDay && !curDate) || /sum\(|[A-Z]+\d+\s*[-+*/]\s*[A-Z]+\d+/i.test(f));
    if (isDeclared) {
      const a = declared(g, r, c.current, "current");
      const b = declared(g, r, c.previous, "previous");
      if (a) decl.push(a);
      if (b) decl.push(b);
      continue;
    }
    if (d) curDate = d;
    if (!curDate) continue;
    seenDay = true;
    rows.push({ row: r + 1, date: curDate, current: cur?.value ?? 0, previous: prev?.value ?? 0 });
  }
  return { src, hidden: g.hidden, headerRow: layout.headerRow, batch, rows, declared: decl };
}

// ------------------------------------------------------------------ doanh thu ngày

/** Tháng và năm từ tên tab: "DOANH THU 102026" → 10/2026; "DOANH THU THÁNG 12026" → 1/2026. */
export function monthYearFromName(name: string): { month: number; year: number } | null {
  const m = /(\d{1,2})(20\d{2})\s*$/.exec(name.trim());
  if (!m) return null;
  const month = Number(m[1]);
  if (month < 1 || month > 12) return null;
  return { month, year: Number(m[2]) };
}

export function extractRevenue(g: Grid, layout: Layout, src: SrcRef): RevenueTable | null {
  const my = monthYearFromName(g.name);
  if (!my) return null;
  const c = layout.cols;
  const rows: RevenueRow[] = [];
  const decl: DeclaredCell[] = [];
  let prevDay = 0;
  let spill = 0;
  let stopped = false;
  let small = 0;
  let large = 0;
  const maxDay = daysInMonth(my.year, my.month);

  const money = (r: number, col: number | undefined, thousands: boolean, cap?: number): number => {
    if (col === undefined) return 0;
    const v = g.num(r, col);
    if (v === null) return 0;
    if (!thousands) return v;
    const t = toVnd(v);
    // Ô nhỏ được đoán là nghìn đồng, nhưng nếu như vậy mà vượt trần hợp lý (ví dụ chiết khấu lớn hơn 10% doanh thu) thì
    // người nhập đã ghi bằng đồng đầy đủ: giữ nguyên giá trị.
    if (t.guessed && cap !== undefined && t.vnd > cap) return v;
    if (v !== 0) {
      if (t.guessed) small++;
      else large++;
    }
    return t.vnd;
  };

  for (let r = layout.headerRow + 1; r <= g.r1; r++) {
    const dayInfo = g.numInfo(r, c.day);
    const rev = g.numInfo(r, c.revenue);
    const asDate = g.date(r, c.day);
    const isDayNumber = dayInfo !== null && Number.isInteger(dayInfo.value) && dayInfo.value >= 1 && dayInfo.value <= maxDay && !asDate;

    if (!stopped && isDayNumber && dayInfo.value > prevDay) {
      prevDay = dayInfo.value;
      if (!rev) continue; // ngày chưa có doanh thu (ví dụ ngày nghỉ)
      rows.push({
        row: r + 1,
        date: `${my.year}-${pad2(my.month)}-${pad2(dayInfo.value)}`,
        revenue: rev.value,
        offline: money(r, c.offline, false),
        online: money(r, c.online, false),
        expense: money(r, c.expense, true),
        transfer: money(r, c.transfer, false),
        // Chiết khấu ghi bằng nghìn đồng ở nhiều tháng (1.028 nghĩa là 1.028.000đ) và là khoản trừ khỏi doanh thu; trần 10% doanh thu.
        discount: money(r, c.discount, true, rev.value * 0.1),
        cash: money(r, c.cash, true),
      });
      continue;
    }
    // Hàng không có số ngày hợp lệ: ô tổng ngay dưới bảng hoặc dòng của tháng sau.
    if (rev) {
      const f = g.formula(r, c.revenue);
      if (dayInfo === null && !asDate && f && /sum/i.test(f)) {
        const d = declared(g, r, c.revenue, "revenue");
        if (d) decl.push(d);
        if (c.cash !== undefined) {
          const dc = declared(g, r, c.cash, "cash");
          if (dc) decl.push(dc);
        }
      } else {
        stopped = true;
        spill++;
      }
    } else if (dayInfo !== null || asDate) {
      stopped = true;
    }
  }
  return { src, hidden: g.hidden, headerRow: layout.headerRow, year: my.year, month: my.month, rows, spill, unitMixed: small > 0 && large > 0, declared: decl };
}

// ------------------------------------------------------------------ báo cáo tháng

export function extractMonthly(g: Grid, layout: Layout, src: SrcRef): MonthlyTable {
  const c = layout.cols;
  const rows: MonthlyRow[] = [];
  const fields = ["revenue", "owed", "received", "paid", "expense", "refund", "left"] as const;
  for (let r = layout.headerRow + 1; r <= g.r1; r++) {
    const m = g.num(r, c.month);
    if (m === null || !Number.isInteger(m) || m < 1 || m > 12) continue;
    const row: MonthlyRow = { row: r + 1, month: m, formulaCells: [] };
    for (const f of fields) {
      const col = c[f];
      if (col === undefined) continue;
      const v = g.num(r, col);
      if (v !== null) row[f] = v;
      if (g.formula(r, col)) row.formulaCells.push(f);
    }
    row.leftFormula = c.left !== undefined ? g.formula(r, c.left) : undefined;
    rows.push(row);
  }
  return { src, hidden: g.hidden, headerRow: layout.headerRow, rows };
}

// ------------------------------------------------------------------ dữ liệu xuất từ hệ thống

function methodOf(s: string): GaOrder["method"] {
  const n = normText(s);
  if (n.includes("chuyen khoan")) return "transfer";
  if (n.includes("truc tiep")) return "direct";
  return "other";
}

function statusOf(s: string): GaOrder["status"] {
  const n = normText(s);
  if (n === "da tra") return "paid";
  if (n === "chua tra") return "unpaid";
  return "other";
}

export function extractGaOrders(g: Grid, layout: Layout, src: SrcRef): GaOrders {
  const c = layout.cols;
  const orders: GaOrder[] = [];
  let unparsed = 0;
  let testOrders = 0;
  let testOwed = 0;
  for (let r = layout.headerRow + 1; r <= g.r1; r++) {
    const raw = g.text(r, c.code);
    if (raw === "") continue;
    const key = parseGaKey(raw);
    if (!key) {
      unparsed++;
      if (/test|qa/i.test(raw)) {
        testOrders++;
        testOwed += g.num(r, c.owed) ?? 0;
      }
      continue;
    }
    const batchCol = c.batch !== undefined ? g.text(r, c.batch) : "";
    const batch = batchCol || key.batch;
    const test = key.test || /test|qa/i.test(batch);
    const owed = g.num(r, c.owed) ?? 0;
    if (test) {
      testOrders++;
      testOwed += owed;
      continue;
    }
    const created = c.created !== undefined ? g.date(r, c.created) : null;
    const paidAt = c.paidAt !== undefined ? g.date(r, c.paidAt) : null;
    const due = c.due !== undefined ? g.date(r, c.due) : null;
    orders.push({
      row: r + 1,
      key: lotKey(key.code, batch),
      code: key.code,
      batch,
      created: created ?? undefined,
      qty: c.qty !== undefined ? (g.num(r, c.qty) ?? 0) : 0,
      sold: c.sold !== undefined ? (g.num(r, c.sold) ?? 0) : 0,
      owed,
      method: c.method !== undefined ? methodOf(g.text(r, c.method)) : "other",
      status: statusOf(g.text(r, c.status)),
      paidAt: paidAt ?? undefined,
      due: due ?? undefined,
      test: false,
    });
  }
  return { src, hidden: g.hidden, orders, unparsed, testOrders, testOwed };
}

const OVERVIEW_TOTALS: [string, keyof GaOverview["totals"]][] = [
  ["tong so don ky gui", "orders"],
  ["tong so san pham", "products"],
  ["tong gia tri ky gui", "totalValue"],
  ["tong tien phai tra kh", "owed"],
  ["da thanh toan", "paid"],
  ["chua thanh toan", "unpaid"],
  ["so don da tra tien", "ordersPaid"],
  ["so don chua tra tien", "ordersUnpaid"],
];

export function extractGaOverview(g: Grid, src: SrcRef): GaOverview {
  const totals: GaOverview["totals"] = {};
  const months: GaMonth[] = [];
  let exportedAt: string | undefined;
  let rangeFrom: string | undefined;
  let rangeTo: string | undefined;

  for (let r = 0; r <= g.r1; r++) {
    const label = g.text(r, 0);
    if (!label) continue;
    const n = normText(label);
    const valueText = g.text(r, 1);
    if (n === "khoang thoi gian") {
      const m = /(\d{4}-\d{2}-\d{2})\D+(\d{4}-\d{2}-\d{2})/.exec(valueText);
      if (m) [rangeFrom, rangeTo] = [m[1], m[2]];
      continue;
    }
    if (n === "ngay xuat bao cao") {
      exportedAt = parseDate(valueText, "dmy") ?? undefined;
      continue;
    }
    const mm = /^thang (\d{1,2}) (\d{4})$/.exec(n);
    if (mm) {
      months.push({
        label,
        month: Number(mm[1]),
        year: Number(mm[2]),
        orders: g.num(r, 1) ?? 0,
        products: g.num(r, 2) ?? 0,
        sold: g.num(r, 3) ?? 0,
        totalValue: g.num(r, 4) ?? 0,
        owed: g.num(r, 5) ?? 0,
        paid: g.num(r, 6) ?? 0,
        unpaid: g.num(r, 7) ?? 0,
      });
      continue;
    }
    for (const [prefix, field] of OVERVIEW_TOTALS) {
      if (n === prefix || n.startsWith(`${prefix} `)) {
        const v = g.num(r, 1);
        if (v !== null && totals[field] === undefined) totals[field] = v;
        break;
      }
    }
  }
  return { src, exportedAt, rangeFrom, rangeTo, totals, months };
}
