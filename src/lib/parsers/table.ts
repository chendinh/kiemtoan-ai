// Biến một bảng (mảng 2 chiều các ô) thành các AuditRecord + dòng tổng cộng khai báo.

import type { AuditRecord, DeclaredTotal, SourceRole } from "@/lib/types";
import {
  type Cell,
  type DateOrder,
  DATE_PREFIX_RE,
  cellText,
  detectDateOrder,
  isDateCell,
  isEmptyCell,
  parseDate,
  parseNumber,
} from "@/lib/util/values";
import { type ColumnMap, type Field, detectColumns, inferColumns, promoteCombinedDate, validateColumns } from "./columns";

export interface Loc {
  sheet?: string;
  row: number;
}

export interface MergeRange {
  r: number;
  c: number;
  rows: number;
  cols: number;
}

export interface TableContext {
  fileId: string;
  fileName: string;
  role: SourceRole;
  nextId: () => string;
}

export interface TableOptions {
  /** Ánh xạ chỉ số hàng trong `rows` sang vị trí hiển thị cho người dùng. */
  locate: (rowIndex: number) => Loc;
  merges?: MergeRange[];
  /** Gộp dòng chỉ có diễn giải vào dòng trước (PDF/văn bản bị xuống dòng). */
  mergeContinuations?: boolean;
  /** Cho phép đoán cột theo nội dung khi không có tiêu đề. */
  allowInfer?: boolean;
}

export interface TableResult {
  records: AuditRecord[];
  totals: DeclaredTotal[];
  scanned: number;
  skipped: number;
  warnings: string[];
  map: ColumnMap | null;
}

const TOTAL_RE = /^(tổng cộng|tổng số|tổng|cộng phát sinh|cộng lũy kế|cộng|total|sub[\s-]?total|grand total)(?![\p{L}\p{N}])/iu;
const BALANCE_ROW_RE =
  /^(số dư|dư đầu|dư cuối|opening balance|closing balance|balance (?:b\/f|c\/f|brought|carried)|brought forward|carried forward)/iu;
/** Chân trang sao kê (lời cảm ơn, ghi chú pháp lý): không bao giờ là giao dịch. */
const FOOTER_TEXT_RE = /^(trân trọng|vietcombank\s*[–-]|ghi chú\s*:|note\s*:)/iu;

export function sampleDateStrings(rows: Cell[][]): string[] {
  const out: string[] = [];
  const limit = Math.min(rows.length, 600);
  for (let r = 0; r < limit; r++) {
    for (const c of rows[r]) {
      if (typeof c === "string" && /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(c.trim())) out.push(c);
    }
  }
  return out;
}

/** Đưa giá trị ô gộp (merge) của vùng tiêu đề xuống mọi ô trong vùng gộp để dò tiêu đề. */
export function expandMergesForHeader(rows: Cell[][], merges: MergeRange[] | undefined, maxRow = 40): Cell[][] {
  if (!merges || merges.length === 0) return rows;
  const out = rows.map((r, i) => (i < maxRow + 2 ? [...r] : r));
  for (const m of merges) {
    if (m.r >= maxRow) continue;
    const v = rows[m.r]?.[m.c];
    if (v === null || v === undefined || isEmptyCell(v)) continue;
    for (let r = m.r; r < m.r + m.rows && r < out.length; r++) {
      for (let c = m.c; c < m.c + m.cols; c++) {
        if (r === m.r && c === m.c) continue;
        const row = out[r];
        while (row.length <= c) row.push(null);
        row[c] = v;
      }
    }
  }
  return out;
}

function isIndexRow(row: Cell[]): boolean {
  const vals: number[] = [];
  for (const c of row) {
    if (isEmptyCell(c)) continue;
    const t = cellText(c).replace(/[()]/g, "");
    if (!/^\d{1,2}$/.test(t)) return false;
    vals.push(Number(t));
  }
  if (vals.length < 3) return false;
  for (let i = 1; i < vals.length; i++) if (vals[i] !== vals[i - 1] + 1) return false;
  return true;
}

function refText(c: Cell | undefined): string | undefined {
  if (c === null || c === undefined || isEmptyCell(c)) return undefined;
  if (isDateCell(c)) return undefined;
  if (typeof c === "number") return Number.isInteger(c) ? String(c) : String(c);
  const t = cellText(c);
  return t || undefined;
}

export function extractFromTable(
  rows: Cell[][],
  map: ColumnMap,
  order: DateOrder,
  ctx: TableContext,
  opts: TableOptions,
): TableResult {
  const records: AuditRecord[] = [];
  const totals: DeclaredTotal[] = [];
  const warnings: string[] = [];
  let scanned = 0;
  let skipped = 0;
  let badDates = 0;
  let bothSides = 0;
  const cols = map.cols;

  const cell = (row: Cell[], f: Field): Cell | undefined => {
    const c = cols[f];
    return c === undefined ? undefined : row[c];
  };
  const text = (row: Cell[], f: Field): string | undefined => {
    const t = cellText(cell(row, f));
    return t || undefined;
  };
  const num = (row: Cell[], f: Field): number | null => {
    const c = cell(row, f);
    return c === undefined ? null : parseNumber(c);
  };

  for (let i = map.dataStart; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(isEmptyCell)) continue;
    scanned++;
    if (isIndexRow(row)) {
      skipped++;
      continue;
    }

    const loc = opts.locate(i);
    if (row.some((c) => typeof c === "string" && FOOTER_TEXT_RE.test(c.trim()))) {
      skipped++;
      continue;
    }
    const dateCell = cell(row, "date");
    let date: string | undefined;
    let dateUnreadable = false;
    if (dateCell !== undefined && !isEmptyCell(dateCell)) {
      const d = parseDate(dateCell, order);
      if (d) date = d;
      else dateUnreadable = true;
    }
    const description = text(row, "description");
    const counterparty = text(row, "counterparty");
    const taxCode = text(row, "taxCode");
    let reference = refText(cell(row, "reference"));
    // Ngày và số chứng từ chung một ô: phần chứng từ là phần còn lại sau ngày.
    if (reference && cols.date !== undefined && cols.date === cols.reference) {
      reference = reference.replace(DATE_PREFIX_RE, "").trim() || undefined;
    }
    const series = text(row, "series");

    // Dòng tổng cộng / số dư: không phải giao dịch.
    // Nhãn "Tổng cộng" có thể nằm ở bất kỳ cột chữ nào (kể cả cột số chứng từ hoặc cột ngày).
    const hasBalanceLabel = row.some((c) => typeof c === "string" && BALANCE_ROW_RE.test(c.trim()));
    if (!date && hasBalanceLabel && !row.some((c) => typeof c === "string" && TOTAL_RE.test(c.trim()))) {
      // Dòng "Số dư cuối kỳ / Closing balance": nhãn có thể nằm ngay trong cột chứng từ.
      skipped++;
      continue;
    }
    if (!date && (reference === undefined || TOTAL_RE.test(reference))) {
      const labelCell = row.find((c) => typeof c === "string" && TOTAL_RE.test(c.trim()));
      if (labelCell !== undefined) {
        const t: DeclaredTotal = {
          sheet: loc.sheet,
          row: loc.row,
          label: cellText(labelCell),
          recordCountBefore: records.length,
        };
        const d = num(row, "debit");
        const c = num(row, "credit");
        const a = num(row, "amount");
        const n = num(row, "net");
        const x = num(row, "tax");
        if (d !== null) t.debit = d;
        if (c !== null) t.credit = c;
        if (a !== null) t.amount = a;
        if (n !== null) t.net = n;
        if (x !== null) t.tax = x;
        if (t.debit !== undefined || t.credit !== undefined || t.amount !== undefined || t.net !== undefined) {
          totals.push(t);
        }
        continue;
      }
      const lead = row.find((c) => typeof c === "string" && c.trim() !== "");
      if (typeof lead === "string" && BALANCE_ROW_RE.test(lead.trim())) {
        skipped++;
        continue;
      }
    }
    if (dateUnreadable) badDates++;

    const debit = num(row, "debit");
    const credit = num(row, "credit");
    const amountRaw = num(row, "amount");
    const net = num(row, "net");
    const tax = num(row, "tax");

    let amount: number | null = null;
    let signed: number | undefined;
    const d = debit ?? 0;
    const c = credit ?? 0;
    if (debit !== null || credit !== null) {
      if (d !== 0 && c !== 0) bothSides++;
      amount = Math.max(Math.abs(d), Math.abs(c));
    }
    if ((amount === null || amount === 0) && amountRaw !== null) {
      amount = Math.abs(amountRaw);
      signed = amountRaw;
    }
    if ((amount === null || amount === 0) && net !== null) {
      amount = Math.abs(net) + Math.abs(tax ?? 0);
    }

    // Dòng chỉ có chữ (xuống dòng của diễn giải) -> gộp vào dòng trước.
    if (amount === null && opts.mergeContinuations && !date && !reference && records.length > 0) {
      const extra = [description, counterparty].filter(Boolean).join(" ");
      if (extra) {
        const prev = records[records.length - 1];
        prev.description = `${prev.description ?? ""} ${extra}`.trim().slice(0, 400);
        continue;
      }
    }

    if (amount === null) {
      skipped++;
      continue;
    }
    if (!date && !reference && !description && !counterparty) {
      skipped++;
      continue;
    }
    if (amount === 0 && !reference) {
      skipped++;
      continue;
    }

    let balance: number | undefined;
    const balRaw = num(row, "balance");
    if (balRaw !== null) balance = balRaw;
    else {
      const bd = num(row, "balanceDebit");
      const bc = num(row, "balanceCredit");
      if (bd !== null || bc !== null) balance = (bd ?? 0) - (bc ?? 0);
    }

    let calcDiff: number | undefined;
    if (amountRaw !== null && net !== null && tax !== null) {
      calcDiff = Math.abs(amountRaw) - (Math.abs(net) + Math.abs(tax));
    }

    const rec: AuditRecord = {
      id: ctx.nextId(),
      fileId: ctx.fileId,
      fileName: ctx.fileName,
      role: ctx.role,
      sheet: loc.sheet,
      row: loc.row,
      amount,
    };
    if (date) rec.date = date;
    if (description) rec.description = description.slice(0, 400);
    if (counterparty) rec.counterparty = counterparty.slice(0, 200);
    if (taxCode) rec.taxCode = taxCode.replace(/\s+/g, "");
    if (reference) rec.reference = reference.slice(0, 80);
    if (series) rec.series = series.slice(0, 40);
    if (debit !== null) rec.debit = debit;
    if (credit !== null) rec.credit = credit;
    if (signed !== undefined) rec.signed = signed;
    if (net !== null) rec.net = net;
    if (tax !== null) rec.tax = tax;
    if (calcDiff !== undefined) rec.calcDiff = calcDiff;
    if (balance !== undefined) rec.balance = balance;
    records.push(rec);
  }

  if (badDates > 0) warnings.push(`${badDates} ô ngày không đọc được (bỏ qua ngày của các dòng đó).`);
  if (bothSides > 0) warnings.push(`${bothSides} dòng có cả số Nợ và số Có; lấy giá trị lớn hơn làm số tiền.`);
  if (map.inferred) warnings.push("Không tìm thấy dòng tiêu đề; các cột được đoán theo nội dung. Hãy kiểm tra ở tab Dữ liệu.");

  return { records, totals, scanned, skipped, warnings, map };
}

/** Dò cột (có tiêu đề hoặc suy luận) rồi trích xuất. Trả về null nếu không nhận diện được bảng. */
export function processTable(rows: Cell[][], ctx: TableContext, opts: TableOptions): TableResult | null {
  if (rows.length === 0) return null;
  const order = detectDateOrder(sampleDateStrings(rows));
  const headerRows = expandMergesForHeader(rows, opts.merges);

  let map = detectColumns(headerRows);
  if (map) map = validateColumns(headerRows, map, order);
  if (map) map = promoteCombinedDate(headerRows, map);
  if (!map && opts.allowInfer !== false) map = inferColumns(rows, order);
  if (!map) return null;

  const source = map.inferred ? rows : headerRows;
  const result = extractFromTable(source, map, order, ctx, opts);
  if (result.records.length === 0 && result.totals.length === 0) return null;
  return result;
}

