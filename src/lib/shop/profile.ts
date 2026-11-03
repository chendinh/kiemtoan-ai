// Hồ sơ cấu trúc của tab chưa nhận diện: nhãn tiêu đề, thống kê và mẫu hình ký tự của từng cột.
// Không giữ giá trị ô dữ liệu: tên, số điện thoại, số tài khoản của khách có thể nằm ở đó.

import * as XLSX from "xlsx";
import { parseDate } from "@/lib/util/values";
import { maskDigits } from "./config";
import { Grid } from "./grid";
import type { ColumnProfile, UnknownTab } from "./types";

const MAX_PROFILE_COLS = 40;
const SAMPLE_ROWS = 400;
const HEADER_SCAN_ROWS = 30;

function charClass(ch: string): string {
  if (/\d/.test(ch)) return "9";
  if (/\s/.test(ch)) return " ";
  if (/\p{Lu}/u.test(ch)) return "A";
  if (/\p{Ll}/u.test(ch)) return "a";
  return ch;
}

/**
 * Mẫu hình ký tự của một ô chữ: chữ hoa → A, chữ thường → a, chữ số → 9.
 * Dãy từ 5 ký tự cùng loại chỉ ghi "+" nên mẫu không cho biết độ dài chính xác của số tài khoản hay số điện thoại.
 */
export function shapeOf(text: string): string {
  const t = text.normalize("NFC").trim().slice(0, 60);
  let out = "";
  let i = 0;
  while (i < t.length) {
    const cls = charClass(t[i]);
    let j = i + 1;
    while (j < t.length && charClass(t[j]) === cls) j++;
    const n = j - i;
    out += n >= 5 && (cls === "9" || cls === "a" || cls === "A") ? `${cls}+` : cls.repeat(n);
    i = j;
  }
  return out;
}

/** Làm tròn 2 chữ số có nghĩa: đủ để biết cỡ số, không lộ số gốc. */
function sig2(x: number): number {
  if (x === 0 || !Number.isFinite(x)) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(Math.abs(x))) - 1);
  return Math.round(x / p) * p;
}

function isDateCell(g: Grid, r: number, c: number): boolean {
  const x = g.cell(r, c);
  if (!x || x.v === undefined || x.v === null) return false;
  if (typeof x.v === "number") return x.z !== undefined && XLSX.SSF.is_date(String(x.z));
  if (typeof x.v === "string") return /[/.-]/.test(x.v) && parseDate(x.v, "dmy") !== null;
  return false;
}

function isNumberValue(g: Grid, r: number, c: number): boolean {
  return typeof g.cell(r, c)?.v === "number";
}

/** Hàng tiêu đề: có từ 3 nhãn chữ, gần như không có ô số, và các hàng ngay dưới đã có số. */
export function guessHeaderRow(g: Grid): number | undefined {
  const last = Math.min(g.r1, HEADER_SCAN_ROWS);
  const cLast = Math.min(g.c1, MAX_PROFILE_COLS - 1);
  for (let r = 0; r <= last; r++) {
    const labels = g.labels(r, MAX_PROFILE_COLS).filter((l) => l.text.length <= 40 && /\p{L}/u.test(l.text));
    if (labels.length < 3) continue;
    let numbersHere = 0;
    for (let c = 0; c <= cLast; c++) if (isNumberValue(g, r, c)) numbersHere++;
    if (numbersHere > 1) continue;
    let numbersBelow = 0;
    for (let rr = r + 1; rr <= Math.min(g.r1, r + 4); rr++) for (let c = 0; c <= cLast; c++) if (isNumberValue(g, rr, c)) numbersBelow++;
    if (numbersBelow >= 2) return r;
  }
  return undefined;
}

export function profileUnknownTab(g: Grid): UnknownTab {
  const headerRow = guessHeaderRow(g);
  const first = headerRow === undefined ? 0 : headerRow + 1;
  const last = Math.min(g.r1, first + SAMPLE_ROWS - 1);
  const cLast = Math.min(g.c1, MAX_PROFILE_COLS - 1);
  const columns: ColumnProfile[] = [];

  for (let c = 0; c <= cLast; c++) {
    let filled = 0;
    let numeric = 0;
    let dates = 0;
    let min = Infinity;
    let max = -Infinity;
    let idLike = 0;
    const patterns = new Map<string, number>();
    for (let r = first; r <= last; r++) {
      if (g.isEmpty(r, c)) continue;
      filled++;
      if (isDateCell(g, r, c)) {
        dates++;
        continue;
      }
      const info = g.numInfo(r, c);
      if (info) {
        numeric++;
        if (info.value < min) min = info.value;
        if (info.value > max) max = info.value;
        if (Number.isInteger(info.value) && info.value >= 100_000_000 && info.value < 1e15) idLike++;
        continue;
      }
      const p = shapeOf(g.text(r, c));
      patterns.set(p, (patterns.get(p) ?? 0) + 1);
    }
    const header = headerRow === undefined ? "" : maskDigits(g.text(headerRow, c)).slice(0, 40);
    if (filled === 0 && header === "") continue;
    // Cột toàn số nguyên dài (từ 9 chữ số) gần như không lặp là mã định danh (số tài khoản, điện thoại, CMND), không phải tiền:
    // không tiết lộ cả phạm vi giá trị của cột đó.
    const looksLikeId = numeric >= 3 && min >= 100_000_000 && Number.isInteger(min) && Number.isInteger(max) && idLike >= numeric * 0.8;
    columns.push({
      col: c,
      letter: Grid.colLetter(c),
      header,
      filled,
      numeric,
      dates,
      min: numeric > 0 && !looksLikeId ? sig2(min) : undefined,
      max: numeric > 0 && !looksLikeId ? sig2(max) : undefined,
      idLike: looksLikeId || undefined,
      patterns: [...patterns.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([p, n]) => ({ p, n })),
    });
  }

  return { sheet: g.name, hidden: g.hidden, rows: g.nonEmptyRows(5000), cols: g.c1 + 1, headerRow, columns };
}
