// Lớp đọc ô của một sheet: giữ công thức, phân biệt số thật với số lưu dạng chữ, đọc ngày theo định dạng ô.
// Truy cập ngẫu nhiên thẳng trên đối tượng sheet của SheetJS nên không cần dựng bảng 2 chiều cho sheet lớn.

import * as XLSX from "xlsx";
import { normText } from "@/lib/util/text";
import { isPlausibleSerial, parseDate, parseNumber, serialToIso } from "@/lib/util/values";

export interface NumInfo {
  value: number;
  /** Ô là chữ nhưng đọc được thành số (SUM bỏ qua ô loại này). */
  text: boolean;
}

export interface Label {
  c: number;
  text: string;
  /** Chữ thường, bỏ dấu, chỉ giữ chữ-số. */
  n: string;
}

const WS = /[\s\u00a0\u202f]+/g;

export class Grid {
  /** Chỉ số hàng/cột cuối (0-based) của vùng dữ liệu; -1 nếu sheet rỗng. */
  readonly r1: number;
  readonly c1: number;
  /** Số hàng bị ẩn (theo `!rows`). */
  private hiddenRowSet: Set<number>;

  constructor(
    readonly ws: XLSX.WorkSheet,
    readonly name: string,
    readonly hidden: boolean,
  ) {
    const ref = ws["!ref"];
    if (ref) {
      const rng = XLSX.utils.decode_range(ref);
      this.r1 = rng.e.r;
      this.c1 = rng.e.c;
    } else {
      this.r1 = -1;
      this.c1 = -1;
    }
    this.hiddenRowSet = new Set<number>();
    (ws["!rows"] ?? []).forEach((info, r) => {
      if (info?.hidden) this.hiddenRowSet.add(r);
    });
  }

  get rowCount(): number {
    return this.r1 + 1;
  }

  addr(r: number, c: number): string {
    return XLSX.utils.encode_cell({ r, c });
  }

  static colLetter(c: number): string {
    return XLSX.utils.encode_col(c);
  }

  static colIndex(letter: string): number {
    return XLSX.utils.decode_col(letter);
  }

  cell(r: number, c: number): XLSX.CellObject | undefined {
    if (r < 0 || c < 0) return undefined;
    return this.ws[this.addr(r, c)] as XLSX.CellObject | undefined;
  }

  /** Chữ hiển thị của ô, đã gọn khoảng trắng. Ô số trả về chuỗi số. */
  text(r: number, c: number): string {
    const x = this.cell(r, c);
    if (!x || x.v === undefined || x.v === null) return "";
    if (typeof x.v === "string") return x.v.replace(WS, " ").trim();
    if (typeof x.v === "number") return Number.isFinite(x.v) ? String(x.v) : "";
    if (typeof x.v === "boolean") return x.v ? "TRUE" : "FALSE";
    return "";
  }

  isEmpty(r: number, c: number): boolean {
    return this.text(r, c) === "";
  }

  numInfo(r: number, c: number): NumInfo | null {
    const x = this.cell(r, c);
    if (!x || x.v === undefined || x.v === null || x.v === "") return null;
    if (typeof x.v === "number") return Number.isFinite(x.v) ? { value: x.v, text: false } : null;
    if (typeof x.v === "string") {
      const n = parseNumber(x.v);
      return n === null ? null : { value: n, text: true };
    }
    return null;
  }

  /** Giá trị số của ô (kể cả số lưu dạng chữ), hoặc null. */
  num(r: number, c: number): number | null {
    return this.numInfo(r, c)?.value ?? null;
  }

  /** Ngày ISO của ô: số có định dạng ngày (hoặc số serial hợp lý) hoặc chuỗi dd/mm/yyyy. */
  date(r: number, c: number): string | null {
    const x = this.cell(r, c);
    if (!x || x.v === undefined || x.v === null || x.v === "") return null;
    if (typeof x.v === "number") {
      const isDateFmt = x.z !== undefined && XLSX.SSF.is_date(String(x.z));
      if (isDateFmt || isPlausibleSerial(x.v)) return serialToIso(x.v);
      return null;
    }
    if (typeof x.v === "string") return parseDate(x.v, "dmy");
    return null;
  }

  formula(r: number, c: number): string | undefined {
    const f = this.cell(r, c)?.f;
    return f ? String(f) : undefined;
  }

  /** Các ô chữ (không rỗng, ngắn) của một hàng kèm dạng chuẩn hóa để so nhãn. */
  labels(r: number, maxCols = 60): Label[] {
    const out: Label[] = [];
    const last = Math.min(this.c1, maxCols - 1);
    for (let c = 0; c <= last; c++) {
      const x = this.cell(r, c);
      if (!x || typeof x.v !== "string") continue;
      const text = x.v.replace(WS, " ").trim();
      if (!text || text.length > 90) continue;
      out.push({ c, text, n: normText(text) });
    }
    return out;
  }

  rowHasValue(r: number): boolean {
    for (let c = 0; c <= this.c1; c++) if (!this.isEmpty(r, c)) return true;
    return false;
  }

  /** Hàng bị ẩn mà vẫn có dữ liệu (1-based). */
  hiddenRowsWithData(limit = 200): number[] {
    const out: number[] = [];
    for (const r of this.hiddenRowSet) {
      if (r > this.r1) continue;
      if (this.rowHasValue(r)) out.push(r + 1);
      if (out.length >= limit) break;
    }
    return out.sort((a, b) => a - b);
  }

  /** Cột bị ẩn mà vẫn có dữ liệu (chữ cái cột). */
  hiddenColsWithData(): string[] {
    const out: string[] = [];
    (this.ws["!cols"] ?? []).forEach((info, c) => {
      if (!info?.hidden || c > this.c1) return;
      for (let r = 0; r <= this.r1; r++) {
        if (!this.isEmpty(r, c)) {
          out.push(Grid.colLetter(c));
          return;
        }
      }
    });
    return out;
  }

  /** Số hàng có ít nhất một ô khác rỗng (đếm trong giới hạn để nhanh). */
  nonEmptyRows(limit = 5000): number {
    let n = 0;
    for (let r = 0; r <= Math.min(this.r1, limit); r++) if (this.rowHasValue(r)) n++;
    return n;
  }
}

/** Phân tích công thức dạng SUM(G4:G423) để biết phạm vi cộng. */
export function parseSumRange(formula: string | undefined): { col: string; from: number; to: number } | undefined {
  if (!formula) return undefined;
  const m = /sum\(\s*\$?([A-Z]{1,3})\$?(\d+)\s*:\s*\$?([A-Z]{1,3})\$?(\d+)\s*\)/i.exec(formula);
  if (!m || m[1].toUpperCase() !== m[3].toUpperCase()) return undefined;
  return { col: m[1].toUpperCase(), from: Number(m[2]), to: Number(m[4]) };
}

/** Các tham chiếu ô trong công thức: [{col, row}] (row 1-based). */
export function formulaRefs(formula: string): { col: string; row: number; text: string }[] {
  const out: { col: string; row: number; text: string }[] = [];
  const re = /\$?([A-Z]{1,3})\$?(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula)) !== null) out.push({ col: m[1], row: Number(m[2]), text: m[0].replace(/\$/g, "") });
  return out;
}
