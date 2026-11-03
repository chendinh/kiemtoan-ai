// Đọc phần đầu/cuối của sao kê ngân hàng: kỳ sao kê, số dư đầu kỳ, số dư cuối kỳ, số tài khoản (chỉ giữ 4 số cuối).
// Dùng để kiểm độ phủ sao kê và tính liên tục của số dư giữa các kỳ. Không giữ tên chủ tài khoản, địa chỉ, CMND.

import type { StatementMeta } from "@/lib/types";
import { normText } from "@/lib/util/text";
import { type Cell, cellText, isDateCell, parseDate } from "@/lib/util/values";

const HEAD_ROWS = 30;
const TAIL_ROWS = 15;

const DATE_RE = /(\d{1,2}[/.-]\d{1,2}[/.-]\d{4}|\d{4}-\d{2}-\d{2})/g;
const AMOUNT_RE = /(-?\d{1,3}(?:[.,]\d{3})+|-?\d+)(?:[.,]\d+)?\s*(?:vnd|vnđ|d)?/i;

function textOf(cell: Cell | undefined): string {
  if (cell !== null && cell !== undefined && isDateCell(cell)) return cell.iso;
  return cellText(cell);
}

/** Số tiền đầu tiên sau một nhãn, ở cùng ô (sau dấu ":") hoặc ở các ô kế bên trong hàng. */
function amountAfterLabel(row: Cell[], labelCol: number, labelText: string): number | undefined {
  const sameCell = labelText.replace(/^[^:]*:/, "");
  const candidates = [sameCell, ...row.slice(labelCol + 1).map(textOf)];
  for (const t of candidates) {
    const s = t.trim();
    if (!s) continue;
    const m = AMOUNT_RE.exec(s.replace(/\s+/g, " "));
    if (!m) continue;
    const raw = m[1];
    const neg = raw.startsWith("-");
    const digits = raw.replace(/[^\d]/g, "");
    if (!digits) continue;
    const v = Number(digits);
    if (!Number.isFinite(v)) continue;
    return neg ? -v : v;
  }
  return undefined;
}

function isoOf(dmy: string): string | undefined {
  return parseDate(dmy, "dmy") ?? undefined;
}

/** Chữ số đứng sau nhãn số tài khoản, che chỉ còn 4 số cuối. */
function maskedAccount(row: Cell[], labelCol: number, labelText: string): string | undefined {
  const candidates = [labelText.replace(/^[^:]*:/, ""), ...row.slice(labelCol + 1).map(textOf)];
  for (const t of candidates) {
    const m = /\d{6,}/.exec(t.replace(/[\s.-]/g, ""));
    if (m) return `***${m[0].slice(-4)}`;
  }
  return undefined;
}

export function extractStatementMeta(rows: Cell[][], sheet: string): StatementMeta | null {
  const meta: StatementMeta = { sheet };
  const scan = (r: number): void => {
    const row = rows[r];
    if (!row) return;
    for (let c = 0; c < row.length; c++) {
      const t = textOf(row[c]);
      if (!t || t.length > 400) continue;
      const n = normText(t);

      if (meta.opening === undefined && /(so du dau ky|opening balance)/.test(n)) {
        const v = amountAfterLabel(row, c, t);
        if (v !== undefined) meta.opening = v;
        continue;
      }
      if (meta.closing === undefined && /(so du cuoi ky|closing balance)/.test(n)) {
        const v = amountAfterLabel(row, c, t);
        if (v !== undefined) meta.closing = v;
        continue;
      }
      if (meta.account === undefined && /(so tai khoan|account number|account no|tai khoan\/ account)/.test(n)) {
        const a = maskedAccount(row, c, t);
        if (a) meta.account = a;
        continue;
      }
      if (meta.from === undefined && /^(tu ngay|tu|from)\b/.test(n) && t.length <= 80) {
        // Kỳ có thể nằm trọn trong một ô ("Từ ngày: 27/09/2026 Đến ngày: 28/10/2026") hoặc rải ở các ô kế bên.
        const joined = [t, ...row.slice(c + 1).map(textOf)].join(" ");
        const dates = [...joined.matchAll(DATE_RE)].map((m) => isoOf(m[1])).filter((d): d is string => !!d);
        if (dates.length >= 2) {
          meta.from = dates[0];
          meta.to = dates[1];
        }
      }
    }
  };

  for (let r = 0; r < Math.min(rows.length, HEAD_ROWS); r++) scan(r);
  for (let r = Math.max(HEAD_ROWS, rows.length - TAIL_ROWS); r < rows.length; r++) scan(r);

  if (meta.from === undefined && meta.opening === undefined && meta.closing === undefined) return null;
  return meta;
}
