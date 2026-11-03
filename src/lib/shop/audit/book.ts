// Gộp dữ liệu shop của mọi file thành một "sổ" duy nhất để các phép kiểm đối chiếu chéo.

import type { AuditRecord, ParsedFile, StatementMeta } from "@/lib/types";
import { SHOP, isBulkCode } from "../config";
import { batchSortKey, lotKey, normCode, parseBatch } from "../keys";
import type {
  DaySummaryTable,
  GaOrder,
  GaOverview,
  LedgerTable,
  LotRow,
  LotsTable,
  MonthlyTable,
  PayoutRow,
  PayoutsTable,
  RevenueTable,
  ShopTab,
  SrcRef,
} from "../types";

export interface PayoutEntry {
  key: string;
  date?: string;
  amount: number;
  src: SrcRef;
  row: number;
  code: string;
  batch: string;
}

/** Lô sau khi gộp các lần xuất hiện của cùng một khóa (mã|đợt) ở nhiều bảng. */
export interface EffLot {
  key: string;
  code: string;
  batch: string;
  owed: number;
  ckDate?: string;
  /** Có bản ghi ở chính bảng của đợt đó (không chỉ là dòng "còn treo" chuyển sang bảng sau). */
  native: boolean;
  src: SrcRef;
  row: number;
  tableBatch?: string;
}

export interface StatementEntry {
  fileId: string;
  fileName: string;
  meta: StatementMeta;
}

export interface GaBook {
  src: SrcRef;
  orders: GaOrder[];
  overview?: GaOverview;
  /** Ngày xuất báo cáo của hệ thống: mốc để xét "đã trả" hay "chưa trả". */
  exportedAt?: string;
  /** Đơn thử nghiệm bị loại khỏi `orders` nhưng hệ thống vẫn tính vào các tổng ở tab tổng quan. */
  testOrders: number;
  testOwed: number;
  unparsed: number;
}

/** Các đơn của hệ thống thuộc cùng một khóa lô (đã quy về khóa chuẩn). */
export interface GaGroup {
  key: string;
  orders: GaOrder[];
  owed: number;
  /** "paid" nếu mọi đơn đã trả, "unpaid" nếu mọi đơn chưa trả, "mixed" nếu lẫn. */
  status: "paid" | "unpaid" | "mixed";
  method: GaOrder["method"];
  first: GaOrder;
}

export interface TabEntry {
  fileId: string;
  fileName: string;
  tab: ShopTab;
}

export interface ShopBook {
  year: number;
  from: string;
  asOf: string;
  today: string;
  /** Mọi tab shop đã nhận diện, kèm file chứa nó. */
  tabs: TabEntry[];
  lotTables: LotsTable[];
  lots: Map<string, EffLot>;
  /** Khóa của từng khách trong lô ghép ("301|326") → khóa của lô ghép ("301+302|326"). */
  alias: Map<string, string>;
  payouts: PayoutEntry[];
  payByKey: Map<string, PayoutEntry[]>;
  gaByKey: Map<string, GaGroup>;
  payoutTables: PayoutsTable[];
  ledgers: LedgerTable[];
  daySummaries: DaySummaryTable[];
  revenues: RevenueTable[];
  monthly: { table: MonthlyTable }[];
  ga?: GaBook;
  statements: StatementEntry[];
  bank: AuditRecord[];
  hasShopTables: boolean;
}

const sumBy = <T>(xs: T[], f: (x: T) => number): number => xs.reduce((s, x) => s + f(x), 0);

/** Gộp lô: ưu tiên bản ở bảng của đợt đó; nếu không có thì lấy dòng còn treo ở bảng mới nhất. */
function mergeLots(tables: LotsTable[]): Map<string, EffLot> {
  type Hit = { table: LotsTable; rows: LotRow[] };
  const byKey = new Map<string, { native: Hit[]; carry: Hit[] }>();
  for (const table of tables) {
    const perKey = new Map<string, LotRow[]>();
    for (const row of table.rows) {
      const list = perKey.get(row.key) ?? [];
      list.push(row);
      perKey.set(row.key, list);
    }
    for (const [key, rows] of perKey) {
      const e = byKey.get(key) ?? { native: [], carry: [] };
      const isNative = rows[0].batch === table.mainBatch;
      (isNative ? e.native : e.carry).push({ table, rows });
      byKey.set(key, e);
    }
  }
  const out = new Map<string, EffLot>();
  for (const [key, e] of byKey) {
    let hit: Hit | undefined;
    if (e.native.length > 0) hit = e.native[0];
    else hit = [...e.carry].sort((a, b) => batchSortKey(b.table.mainBatch ?? "") - batchSortKey(a.table.mainBatch ?? ""))[0];
    if (!hit) continue;
    const first = hit.rows[0];
    out.set(key, {
      key,
      code: first.code,
      batch: first.batch,
      owed: sumBy(hit.rows, (r) => r.owed),
      ckDate: hit.rows.map((r) => r.ckDate).filter((d): d is string => !!d).sort().pop(),
      native: e.native.length > 0,
      src: hit.table.src,
      row: first.row,
      tableBatch: hit.table.mainBatch,
    });
  }
  return out;
}

export function buildBook(files: ParsedFile[], records: AuditRecord[], today: string): ShopBook {
  const lotTables: LotsTable[] = [];
  const payoutTables: PayoutsTable[] = [];
  const ledgers: LedgerTable[] = [];
  const daySummaries: DaySummaryTable[] = [];
  const revenues: RevenueTable[] = [];
  const monthly: { table: MonthlyTable }[] = [];
  const statements: StatementEntry[] = [];
  const tabs: TabEntry[] = [];
  let ga: GaBook | undefined;
  let hasShopTables = false;

  for (const f of files) {
    for (const m of f.statements ?? []) statements.push({ fileId: f.fileId, fileName: f.fileName, meta: m });
    const s = f.shop;
    if (!s) continue;
    hasShopTables = true;
    for (const tab of s.tabs) tabs.push({ fileId: f.fileId, fileName: f.fileName, tab });
    lotTables.push(...s.lots);
    payoutTables.push(...s.payouts);
    ledgers.push(...s.ledgers);
    daySummaries.push(...s.daySummaries);
    revenues.push(...s.revenues);
    monthly.push(...s.monthly.map((table) => ({ table })));
    if (s.gaOrders.length > 0) {
      const orders = s.gaOrders.flatMap((t) => t.orders);
      const overview = s.gaOverview[0];
      ga = {
        src: s.gaOrders[0].src,
        orders,
        overview,
        exportedAt: overview?.exportedAt,
        testOrders: sumBy(s.gaOrders, (t) => t.testOrders),
        testOwed: sumBy(s.gaOrders, (t) => t.testOwed),
        unparsed: sumBy(s.gaOrders, (t) => t.unparsed),
      };
    }
  }

  const lots = mergeLots(lotTables);

  // Lô ghép nhiều khách ("301+302"): hệ thống và danh sách chuyển khoản có thể ghi từng khách riêng, nên quy về khóa của lô ghép.
  const alias = new Map<string, string>();
  for (const lot of lots.values()) {
    if (!lot.code.includes("+")) continue;
    for (const part of lot.code.split("+")) {
      const p = normCode(part);
      if (p) alias.set(lotKey(p, lot.batch), lot.key);
    }
  }
  const canon = (key: string): string => alias.get(key) ?? key;

  const payouts: PayoutEntry[] = [];
  const payByKey = new Map<string, PayoutEntry[]>();
  for (const t of payoutTables) {
    for (const r of t.rows as PayoutRow[]) {
      const key = canon(r.key);
      const e: PayoutEntry = { key, date: r.date, amount: r.amount, src: t.src, row: r.row, code: key.split("|")[0], batch: r.batch };
      payouts.push(e);
      const list = payByKey.get(key) ?? [];
      list.push(e);
      payByKey.set(key, list);
    }
  }

  const gaByKey = new Map<string, GaGroup>();
  for (const o of ga?.orders ?? []) {
    if (isBulkCode(o.code)) continue;
    const key = canon(o.key);
    const g = gaByKey.get(key);
    if (g) {
      g.orders.push(o);
      g.owed += o.owed;
      if (g.status !== (o.status === "paid" ? "paid" : "unpaid")) g.status = "mixed";
    } else {
      gaByKey.set(key, { key, orders: [o], owed: o.owed, status: o.status === "paid" ? "paid" : "unpaid", method: o.method, first: o });
    }
  }

  const bank = records.filter((r) => r.role === "bank");

  // Mốc "đến nay" của dữ liệu: ngày giao dịch muộn nhất của chuyển khoản hoặc sao kê, không vượt quá hôm nay.
  // Không dùng ngày của sổ thu chi vì ô ngày trong sổ có thể gõ nhầm sang tương lai.
  let asOf: string = SHOP.from;
  for (const p of payouts) if (p.date && p.date <= today && p.date > asOf) asOf = p.date;
  for (const b of bank) if (b.date && b.date <= today && b.date > asOf) asOf = b.date;

  return {
    year: SHOP.year,
    from: SHOP.from,
    asOf,
    today,
    tabs,
    lotTables,
    lots,
    alias,
    payouts,
    payByKey,
    gaByKey,
    payoutTables,
    ledgers,
    daySummaries,
    revenues,
    monthly,
    ga,
    statements,
    bank,
    hasShopTables,
  };
}

/** Hạn trả của một đợt: ngày `dueDay` của tháng đợt. */
export function dueDateOf(batch: string): string | null {
  const b = parseBatch(batch);
  if (!b) return null;
  return `${b.year}-${String(b.month).padStart(2, "0")}-${String(SHOP.dueDay).padStart(2, "0")}`;
}
