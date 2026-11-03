// Sao kê ngân hàng: độ phủ kỳ kiểm, số dư nối liên tục giữa các kỳ, và đối chiếu hai chiều giữa khoản "đã nhận" của sổ thu chi
// với lệnh chuyển tiền cho quản lý trên sao kê.

import type { AuditRecord, EvidenceRow } from "@/lib/types";
import { normText } from "@/lib/util/text";
import { addDays, dayDiff } from "@/lib/util/values";
import { SHOP } from "../config";
import type { ShopBook, StatementEntry } from "./book";
import { CheckBuilder, type ModuleOut, type Shared, dmy, emptyOut, monthOfIso, severityByAmount, sum, topByAmount, vnd } from "./helpers";

const accountOf = (s: StatementEntry): string => s.meta.account ?? `file ${s.fileId}`;

interface Receipt {
  date: string;
  amount: number;
  tab: string;
  row: number;
  src: StatementEntry | null;
  used: boolean;
  how?: "1-1" | "1-n" | "partial";
  /** Với ghép một phần: tổng các lệnh chuyển tìm được và số tiền sổ ghi nhiều hơn sao kê. */
  partial?: { found: number; shortBy: number; parts: Debit[] };
}
interface Debit {
  rec: AuditRecord;
  date: string;
  amount: number;
  used: boolean;
}

function matchReceipts(receipts: Receipt[], debits: Debit[], window: number): void {
  // Một-một: cùng số tiền, ưu tiên lệch ngày nhỏ nhất.
  for (const r of receipts) {
    let best = -1;
    let bestGap = Infinity;
    debits.forEach((d, i) => {
      if (d.used || d.amount !== r.amount) return;
      const gap = Math.abs(dayDiff(d.date, r.date));
      if (gap <= window && gap < bestGap) {
        best = i;
        bestGap = gap;
      }
    });
    if (best >= 0) {
      debits[best].used = true;
      r.used = true;
      r.how = "1-1";
    }
  }
  // Một-nhiều: hai hoặc ba lệnh chuyển trong cửa sổ có tổng đúng bằng khoản nhận.
  for (const r of receipts) {
    if (r.used) continue;
    const cand = debits.map((d, i) => ({ d, i })).filter(({ d }) => !d.used && Math.abs(dayDiff(d.date, r.date)) <= window && d.amount < r.amount);
    let found: number[] | null = null;
    for (let a = 0; a < cand.length && !found; a++) {
      for (let b2 = a + 1; b2 < cand.length && !found; b2++) {
        if (cand[a].d.amount + cand[b2].d.amount === r.amount) found = [cand[a].i, cand[b2].i];
        else {
          for (let c = b2 + 1; c < cand.length && !found; c++) {
            if (cand[a].d.amount + cand[b2].d.amount + cand[c].d.amount === r.amount) found = [cand[a].i, cand[b2].i, cand[c].i];
          }
        }
      }
    }
    if (found) {
      for (const i of found) debits[i].used = true;
      r.used = true;
      r.how = "1-n";
    }
  }
  // Ghép một phần: các lệnh chuyển trong cửa sổ cộng lại chưa tới số sổ ghi nhưng đã chiếm phần lớn (từ 50%). Phần thiếu được báo riêng,
  // vì thường là sổ cộng thêm một khoản không đi qua sao kê (tiền mặt) hoặc ghi dư.
  for (const r of receipts) {
    if (r.used) continue;
    const cand = debits
      .filter((d) => !d.used && Math.abs(dayDiff(d.date, r.date)) <= window)
      .sort((x, y) => Math.abs(dayDiff(x.date, r.date)) - Math.abs(dayDiff(y.date, r.date)) || y.amount - x.amount);
    const parts: Debit[] = [];
    let total = 0;
    for (const d of cand) {
      if (total + d.amount > r.amount) continue;
      parts.push(d);
      total += d.amount;
    }
    if (parts.length > 0 && total >= r.amount * 0.5) {
      for (const d of parts) d.used = true;
      r.used = true;
      r.how = "partial";
      r.partial = { found: total, shortBy: r.amount - total, parts };
    }
  }
}

export function bankChecks(b: ShopBook, sh: Shared): ModuleOut {
  const out = emptyOut();
  const { ev } = sh;
  const tol = SHOP.tolerance;
  const stmts = b.statements.filter((s) => s.meta.from && s.meta.to);
  if (stmts.length === 0 && b.bank.length === 0) return out;

  const covCk = new CheckBuilder("bank.coverage", "bank", "Sao kê phủ kỳ kiểm");
  const chainCk = new CheckBuilder("bank.chain", "bank", "Số dư sao kê nối liên tục và cộng đúng");
  const ledgerCk = new CheckBuilder("bank.ledger", "bank", "Khoản nhận trong sổ có lệnh chuyển trên sao kê (và ngược lại)");

  const byAccount = new Map<string, StatementEntry[]>();
  for (const s of stmts) {
    const list = byAccount.get(accountOf(s)) ?? [];
    list.push(s);
    byAccount.set(accountOf(s), list);
  }
  for (const list of byAccount.values()) list.sort((x, y) => (x.meta.from as string).localeCompare(y.meta.from as string));

  const lastMonth = Number(b.asOf.slice(5, 7));
  const monthStart = (m: number): string => `${b.year}-${String(m).padStart(2, "0")}-01`;
  const monthEnd = (m: number): string => addDays(m === 12 ? `${b.year + 1}-01-01` : monthStart(m + 1), -1);

  // ------------------------------------------------------------ độ phủ và nối số dư
  const chainRows: EvidenceRow[] = [];
  let chainSum = 0;
  const srcFor = (s: StatementEntry) => ({ fileId: s.fileId, fileName: s.fileName, sheet: s.meta.sheet });

  for (const [acct, list] of byAccount) {
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const cur = list[i];
      const prevTo = prev.meta.to as string;
      const curFrom = cur.meta.from as string;
      const pc = prev.meta.closing;
      const co = cur.meta.opening;
      if (pc !== undefined && co !== undefined && curFrom <= addDays(prevTo, 1)) {
        const m = monthOfIso(curFrom, b.year);
        chainCk.judged(m);
        if (Math.abs(co - pc) > tol) {
          chainSum += Math.abs(co - pc);
          chainRows.push(
            ev.row(srcFor(cur), 1, {
              date: curFrom,
              role: "bank",
              description: `Tài khoản ${acct}: sao kê kết thúc ${dmy(prevTo)} với số dư ${vnd(pc)} nhưng sao kê kế tiếp mở ${dmy(curFrom)} với ${vnd(co)}`,
              amount: Math.abs(co - pc),
              note: "Số dư đầu kỳ không bằng số dư cuối kỳ trước: một sao kê đã bị sửa hoặc thiếu một đoạn ở giữa",
            }),
          );
          chainCk.issue(m, Math.abs(co - pc));
        }
      }
    }
    // Đầu kỳ + ghi có − ghi nợ phải bằng cuối kỳ.
    for (const s of list) {
      const { opening, closing } = s.meta;
      if (opening === undefined || closing === undefined) continue;
      const recs = b.bank.filter((r) => r.fileId === s.fileId && (r.sheet ?? "") === s.meta.sheet);
      const credit = sum(recs.map((r) => r.credit ?? 0));
      const debit = sum(recs.map((r) => r.debit ?? 0));
      const m = monthOfIso(s.meta.from, b.year);
      chainCk.judged(m);
      const expected = opening + credit - debit;
      if (Math.abs(expected - closing) > tol) {
        chainSum += Math.abs(expected - closing);
        chainRows.push(
          ev.row(srcFor(s), 1, {
            date: s.meta.to,
            role: "bank",
            description: `Tài khoản ${acct} kỳ ${dmy(s.meta.from)}–${dmy(s.meta.to)}: đầu kỳ ${vnd(opening)} + ghi có ${vnd(credit)} − ghi nợ ${vnd(debit)} = ${vnd(expected)}, nhưng cuối kỳ ghi ${vnd(closing)}`,
            amount: Math.abs(expected - closing),
            note: `Lệch ${vnd(expected - closing)}đ: số giao dịch đọc được (${recs.length}) có thể thiếu, hoặc file sao kê đã bị sửa`,
          }),
        );
        chainCk.issue(m, Math.abs(expected - closing));
      }
    }
  }

  // Khoảng thiếu sao kê. "Chắc chắn thiếu" là những ngày không sao kê nào (của bất kỳ tài khoản nào) phủ tới.
  // "Có thể thiếu" là khoảng một tài khoản chưa có sao kê nhưng đã có sao kê của tài khoản khác phủ
  // (tài khoản kia có thể chưa dùng vào thời điểm ấy, cần người dùng xác nhận).
  interface Seg {
    from: string;
    to: string;
  }
  const allRanges: Seg[] = stmts.map((s) => ({ from: s.meta.from as string, to: s.meta.to as string })).sort((x, y) => x.from.localeCompare(y.from));
  /** Các đoạn của [from, to] không nằm trong `ranges`. */
  const subtract = (from: string, to: string, ranges: Seg[]): Seg[] => {
    const out2: Seg[] = [];
    let cursor = from;
    for (const r of ranges) {
      if (r.to < cursor) continue;
      if (r.from > to) break;
      if (r.from > cursor) out2.push({ from: cursor, to: addDays(r.from, -1) });
      cursor = addDays(r.to, 1);
      if (cursor > to) break;
    }
    if (cursor <= to) out2.push({ from: cursor, to });
    return out2;
  };
  const definiteSegs = subtract(b.from, b.asOf, allRanges);

  interface AcctGap extends Seg {
    acct: string;
    opening?: number;
  }
  const possibleGaps: AcctGap[] = [];
  for (const [acct, list] of byAccount) {
    const own: Seg[] = list.map((s) => ({ from: s.meta.from as string, to: s.meta.to as string }));
    for (const g of subtract(b.from, b.asOf, own)) {
      // Bỏ phần đã là "chắc chắn thiếu"; chỉ giữ phần có sao kê của tài khoản khác phủ.
      const rest = subtract(g.from, g.to, definiteSegs);
      for (const part of rest) {
        if (dayDiff(part.to, part.from) < 7) continue; // vài ngày cuối kỳ không đáng nhắc
        const isLeading = part.from === b.from || part.from <= (own[0]?.from ?? "");
        possibleGaps.push({ ...part, acct, opening: isLeading ? list[0].meta.opening : undefined });
      }
    }
  }
  const definiteGaps = definiteSegs;
  const uncovered: number[] = [];
  for (let m = 1; m <= lastMonth; m++) {
    covCk.judged(m);
    const mFrom = monthStart(m);
    const mTo = monthEnd(m) > b.asOf ? b.asOf : monthEnd(m);
    if (definiteSegs.some((g) => g.from <= mTo && g.to >= mFrom)) {
      uncovered.push(m);
      covCk.issue(m, 0);
    }
  }
  const gapRow = (g: Seg): EvidenceRow =>
    ev.row(srcFor(stmts[0]), 1, {
      date: g.from,
      role: "bank",
      description: `Không có sao kê nào phủ từ ${dmy(g.from)} đến ${dmy(g.to)}`,
      amount: 0,
      note: "Không đối chiếu được tiền thực nhận/chi trong giai đoạn này với ngân hàng",
    });
  if (definiteGaps.length > 0) {
    out.coverage.push({
      kind: "statement",
      level: "warn",
      label: `Không có sao kê nào phủ: ${definiteGaps.map((g) => `${dmy(g.from)}–${dmy(g.to)}`).join("; ")}`,
      detail: "Tải thêm sao kê cho khoảng này; nếu không, khoản nhận trong giai đoạn đó chỉ kiểm được bằng sổ nội bộ.",
    });
    out.drafts.push({
      rule: "statement_gap",
      severity: "medium",
      title: `Thiếu sao kê ngân hàng: ${definiteGaps.length} khoảng`,
      description:
        `Sao kê đã tải lên không phủ hết kỳ kiểm (${dmy(b.from)} đến ${dmy(b.asOf)}). Phần chưa có sao kê không thể đối chiếu tiền thực nhận/thực chi với sổ sách, ` +
        `nên mọi khoản nhận trong giai đoạn đó chỉ được kiểm bằng sổ nội bộ.`,
      recommendation: "Tải sao kê còn thiếu từ ngân hàng (Internet Banking cho xuất theo tháng) và chạy lại.",
      records: [],
      evidenceOverride: definiteGaps.map(gapRow),
      total: definiteGaps.length,
      amount: 0,
    });
  }
  if (possibleGaps.length > 0) {
    const notes = possibleGaps.map((g) => `tài khoản ${g.acct} ${dmy(g.from)}–${dmy(g.to)}`);
    const withBalance = possibleGaps.filter((g) => g.opening !== undefined && g.opening !== 0);
    out.coverage.push({
      kind: "statement",
      level: "info",
      label: `Có thể thiếu sao kê: ${notes.join("; ")}`,
      detail:
        "Các khoảng này đã có sao kê của tài khoản khác phủ. Nếu tài khoản còn lại cũng được dùng cho shop trong khoảng đó thì cần tải thêm." +
        (withBalance.length > 0
          ? ` Sao kê đầu tiên của ${withBalance.map((g) => `tài khoản ${g.acct}`).join(", ")} đã có số dư đầu kỳ khác 0 (${withBalance.map((g) => `${vnd(g.opening as number)}đ`).join(", ")}) nên tài khoản đó đã tồn tại và đang có tiền trước thời điểm đó.`
          : ""),
    });
  }
  if (chainRows.length > 0) {
    out.drafts.push({
      rule: "statement_gap",
      severity: severityByAmount(chainSum, 1_000_000, tol),
      title: `Số dư sao kê không nối hoặc không cộng đúng: ${chainRows.length} chỗ, ${vnd(chainSum)}đ`,
      description:
        `${chainRows.length} chỗ trên sao kê có số dư đầu kỳ khác cuối kỳ trước, hoặc đầu kỳ cộng ghi có trừ ghi nợ không bằng cuối kỳ, tổng ${vnd(chainSum)}đ. ` +
        `Sao kê do ngân hàng xuất luôn nhất quán; lệch nghĩa là file bị sửa hoặc thiếu giao dịch.`,
      recommendation: "Lấy lại sao kê trực tiếp từ ngân hàng cho kỳ lệch và so với bản đang có.",
      records: [],
      evidenceOverride: chainRows,
      total: chainRows.length,
      amount: chainSum,
    });
  }
  out.checks.push(
    covCk.build(
      uncovered.length === 0
        ? `mọi tài khoản đã biết có sao kê phủ từ tháng 1 đến tháng ${lastMonth}`
        : `không sao kê nào phủ tháng ${uncovered.join(", ")}${possibleGaps.length > 0 ? `; ${possibleGaps.length} khoảng của tài khoản khác có thể thiếu` : ""}`,
    ),
    chainCk.build(chainRows.length === 0 ? `${stmts.length} sao kê có số dư nối liên tục và cộng đúng` : `${chainRows.length} chỗ không nối/không cộng đúng`),
  );

  // ------------------------------------------------------------ sổ thu chi ↔ lệnh chuyển cho quản lý
  const names = SHOP.managerNames as readonly string[];
  const isManagerDebit = (r: AuditRecord): boolean => {
    if (!((r.debit ?? 0) > 0) || !r.date || r.date < b.from) return false;
    const t = normText(`${r.counterparty ?? ""} ${r.description ?? ""}`);
    return names.some((n) => t.includes(n));
  };
  const debits: Debit[] = b.bank.filter(isManagerDebit).map((rec) => ({ rec, date: rec.date as string, amount: rec.debit as number, used: false }));

  const receipts: Receipt[] = [];
  for (const t of b.ledgers) {
    for (const r of t.rows) {
      for (const f of r.flows) {
        if (f.field !== "received" || !f.date || f.date < b.from || f.value <= 0) continue;
        receipts.push({ date: f.date, amount: f.value, tab: t.src.sheet, row: f.row, src: null, used: false });
      }
    }
  }
  receipts.sort((x, y) => x.date.localeCompare(y.date));

  const byMonthRecv: Record<number, number> = {};
  const byMonthDeb: Record<number, number> = {};
  for (const r of receipts) {
    const m = monthOfIso(r.date, b.year);
    if (m !== null) byMonthRecv[m] = (byMonthRecv[m] ?? 0) + r.amount;
  }
  for (const d of debits) {
    const m = monthOfIso(d.date, b.year);
    if (m !== null) byMonthDeb[m] = (byMonthDeb[m] ?? 0) + d.amount;
  }

  if (receipts.length > 0 && debits.length > 0) {
    matchReceipts(receipts, debits, SHOP.bankWindowDays);

    // Chỉ kết luận với khoản nhận nằm trong kỳ của một sao kê thuộc tài khoản từng chuyển tiền cho quản lý,
    // và sao kê đó phải có đủ hoạt động: tài khoản mà cả tháng chỉ có vài giao dịch là tài khoản không còn dùng thật,
    // nên việc không thấy lệnh chuyển ở đó không nói lên điều gì (tiền có thể đi từ tài khoản khác chưa có sao kê).
    const payerFiles = new Set(debits.map((d) => `${d.rec.fileId}|${d.rec.sheet ?? ""}`));
    const payerAccounts = new Set(
      stmts.filter((s) => payerFiles.has(`${s.fileId}|${s.meta.sheet}`)).map((s) => accountOf(s)),
    );
    const payerStmts = stmts.filter((s) => payerAccounts.has(accountOf(s)));
    const activity = (s: StatementEntry): number => b.bank.filter((r) => r.fileId === s.fileId && (r.sheet ?? "") === s.meta.sheet).length;
    /** Số sao kê hoạt động bình thường của tài khoản = trung vị số giao dịch các kỳ của nó. */
    const typical = (() => {
      const counts = payerStmts.map(activity).sort((x, y) => x - y);
      return counts.length ? counts[Math.floor(counts.length / 2)] : 0;
    })();
    const THIN = Math.max(30, typical * 0.1);
    const covering = (date: string): StatementEntry[] => payerStmts.filter((s) => (s.meta.from as string) <= date && date <= (s.meta.to as string));
    const covered = (date: string): boolean => covering(date).length > 0;
    const isThin = (date: string): boolean => covering(date).every((s) => activity(s) < THIN);

    const noDebit: EvidenceRow[] = [];
    let noDebitSum = 0;
    let uncoveredN = 0;
    let uncoveredSum = 0;
    let thinN = 0;
    let thinSum = 0;
    const thinMonths = new Set<number>();
    const partialRows: EvidenceRow[] = [];
    let partialSum = 0;
    let matched = 0;
    for (const r of receipts) {
      const m = monthOfIso(r.date, b.year);
      if (!covered(r.date)) {
        uncoveredN++;
        uncoveredSum += r.amount;
        continue;
      }
      if (r.used && r.how === "partial" && r.partial) {
        ledgerCk.judged(m);
        partialSum += r.partial.shortBy;
        partialRows.push(
          ev.row(
            { fileId: b.ledgers[0]?.src.fileId ?? "", fileName: b.ledgers[0]?.src.fileName ?? "", sheet: r.tab },
            r.row,
            {
              date: r.date,
              description: `Sổ thu chi ghi quản lý nhận ${vnd(r.amount)}đ ngày ${dmy(r.date)}; sao kê chỉ có ${r.partial.parts.length} lệnh chuyển cộng ${vnd(r.partial.found)}đ`,
              amount: r.partial.shortBy,
              note: `Thiếu ${vnd(r.partial.shortBy)}đ so với sổ. Các lệnh: ${r.partial.parts.map((p) => `${dmy(p.date)} ${vnd(p.amount)}đ`).join("; ")}. Phần thiếu có thể là tiền mặt không qua ngân hàng hoặc sổ ghi dư`,
            },
          ),
        );
        ledgerCk.issue(m, r.partial.shortBy);
        continue;
      }
      if (r.used) {
        ledgerCk.judged(m);
        matched++;
        continue;
      }
      if (isThin(r.date)) {
        thinN++;
        thinSum += r.amount;
        if (m !== null) thinMonths.add(m);
        continue;
      }
      ledgerCk.judged(m);
      noDebitSum += r.amount;
      noDebit.push(
        ev.row(
          { fileId: b.ledgers[0]?.src.fileId ?? "", fileName: b.ledgers[0]?.src.fileName ?? "", sheet: r.tab },
          r.row,
          {
            date: r.date,
            description: `Sổ thu chi ghi quản lý nhận ${vnd(r.amount)}đ ngày ${dmy(r.date)} nhưng sao kê không có lệnh chuyển tương ứng (±${SHOP.bankWindowDays} ngày)`,
            amount: r.amount,
          },
        ),
      );
      ledgerCk.issue(m, r.amount);
    }

    const noLedger: EvidenceRow[] = [];
    let noLedgerSum = 0;
    for (const d of debits) {
      if (d.used) continue;
      const m = monthOfIso(d.date, b.year);
      ledgerCk.judged(m);
      noLedgerSum += d.amount;
      noLedger.push(
        ev.row(
          { fileId: d.rec.fileId, fileName: d.rec.fileName, sheet: d.rec.sheet ?? "" },
          d.rec.row,
          {
            date: d.date,
            role: "bank",
            reference: d.rec.id,
            description: `Sao kê có lệnh chuyển ${vnd(d.amount)}đ cho quản lý ngày ${dmy(d.date)} nhưng sổ thu chi không có khoản nhận tương ứng (±${SHOP.bankWindowDays} ngày)`,
            amount: d.amount,
          },
        ),
      );
      ledgerCk.issue(m, d.amount);
    }

    if (noDebit.length > 0) {
      out.drafts.push({
        rule: "bank_ledger_mismatch",
        severity: severityByAmount(noDebitSum, 100_000_000, 10_000_000),
        title: `Sổ ghi quản lý đã nhận nhưng sao kê không có lệnh chuyển: ${noDebit.length} khoản, ${vnd(noDebitSum)}đ`,
        description:
          `${noDebit.length} khoản "đã nhận" trong sổ thu chi, tổng ${vnd(noDebitSum)}đ, không ghép được với lệnh chuyển nào cho quản lý trên sao kê (một-một hoặc một-nhiều, lệch tối đa ${SHOP.bankWindowDays} ngày). ` +
          `${matched} khoản khác ghép được. Chỉ xét các ngày mà sao kê có đủ hoạt động (tài khoản có từ ${THIN.toLocaleString("vi-VN")} giao dịch/kỳ trở lên); ` +
          `có thể tiền đi từ một tài khoản khác chưa tải sao kê, hoặc khoản nhận trong sổ không có thật.`,
        recommendation: "Với từng khoản, hỏi người chuyển tiền đã chuyển từ tài khoản nào; tải sao kê tài khoản đó để đối chiếu. Khoản không tìm được nguồn cần giải trình.",
        records: [],
        evidenceOverride: topByAmount(noDebit),
        total: noDebit.length,
        amount: noDebitSum,
        meta: { matched, notCovered: uncoveredN, thinStatement: thinN },
      });
    }
    if (partialRows.length > 0) {
      const partialMax = partialRows.reduce((mx, r) => Math.max(mx, r.amount), 0);
      out.drafts.push({
        rule: "bank_ledger_mismatch",
        // Phần thiếu thường là tiền mặt hoặc chuyển từ tài khoản khác nên chỉ lên mức Cao khi có một khoản đơn lẻ thiếu rất lớn.
        severity: severityByAmount(partialMax, 100_000_000, 10_000_000) === "high" ? "high" : "medium",
        title: `Sổ ghi nhận nhiều hơn sao kê đã chuyển: ${partialRows.length} khoản, thiếu ${vnd(partialSum)}đ`,
        description:
          `${partialRows.length} khoản "đã nhận" trong sổ thu chi chỉ ghép được một phần với các lệnh chuyển trên sao kê (trong ±${SHOP.bankWindowDays} ngày, từ 50% số tiền trở lên); ` +
          `phần sổ ghi nhiều hơn là ${vnd(partialSum)}đ. Có thể phần này là tiền mặt không đi qua ngân hàng, hoặc sổ ghi nhận thừa.`,
        recommendation: "Với từng khoản, hỏi người giữ tiền phần còn lại đến từ đâu (tiền mặt, tài khoản khác) và yêu cầu chứng từ.",
        records: [],
        evidenceOverride: topByAmount(partialRows),
        total: partialRows.length,
        amount: partialSum,
      });
    }
    if (noLedger.length > 0) {
      out.drafts.push({
        rule: "bank_ledger_mismatch",
        severity: severityByAmount(noLedgerSum, 100_000_000, 10_000_000),
        title: `Sao kê có lệnh chuyển cho quản lý nhưng sổ không ghi nhận: ${noLedger.length} khoản, ${vnd(noLedgerSum)}đ`,
        description:
          `${noLedger.length} lệnh chuyển tiền từ tài khoản của shop cho quản lý, tổng ${vnd(noLedgerSum)}đ, không có khoản "đã nhận" tương ứng trong sổ thu chi. ` +
          `Tiền đã ra khỏi tài khoản nhưng không vào sổ của người giữ tiền, nên không biết khoản đó được chi vào đâu.`,
        recommendation: "Hỏi quản lý khoản này dùng vào việc gì và đã ghi ở đâu; bổ sung vào sổ thu chi nếu hợp lệ.",
        records: [],
        evidenceOverride: topByAmount(noLedger),
        total: noLedger.length,
        amount: noLedgerSum,
      });
    }
    if (thinN > 0) {
      const ms = [...thinMonths].sort((x, y) => x - y);
      out.coverage.push({
        kind: "statement",
        level: "warn",
        label: `${thinN} khoản nhận (${vnd(thinSum)}đ) rơi vào kỳ mà sao kê có quá ít giao dịch (tháng ${ms.join(", ")}) nên chưa đối chiếu được`,
        detail:
          "Tài khoản chuyển tiền cho quản lý gần như không có giao dịch trong các kỳ này, nghĩa là tiền đã đi từ tài khoản khác. " +
          "Cần sao kê của tài khoản đó để đối chiếu khoản nhận trong sổ.",
      });
    }
    if (uncoveredN > 0) {
      out.coverage.push({
        kind: "statement",
        level: "info",
        label: `${uncoveredN} khoản nhận (${vnd(uncoveredSum)}đ) nằm ngoài kỳ của mọi sao kê tài khoản chuyển tiền nên không đối chiếu được`,
      });
    }
    out.checks.push(
      ledgerCk.build(
        `${matched}/${receipts.length} khoản nhận ghép đủ với lệnh chuyển; ${partialRows.length} chỉ ghép một phần, ${noDebit.length} không có lệnh chuyển, ${noLedger.length} lệnh chuyển không có trong sổ; ${uncoveredN + thinN} khoản chưa đối chiếu được (ngoài kỳ hoặc sao kê quá mỏng)`,
      ),
    );
  } else if (receipts.length > 0) {
    out.coverage.push({
      kind: "statement",
      level: "warn",
      label: "Không thấy lệnh chuyển nào cho quản lý trên sao kê đã tải lên",
      detail: `Tên người nhận cần có trong nội dung sao kê. Đang tìm: ${names.join(", ")}. Sửa trong lib/shop/config.ts nếu khác.`,
    });
  }

  out.figures.push(
    { id: "fig.bank_to_manager", label: "Chuyển cho quản lý", source: "Sao kê ngân hàng (lệnh chuyển có tên người nhận)", months: byMonthDeb },
    { id: "fig.ledger_recv_date", label: "Tiền nhận theo ngày ghi", source: "Sổ thu chi (theo ngày của từng khoản)", months: byMonthRecv },
  );
  return out;
}
