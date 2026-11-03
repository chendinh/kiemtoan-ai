// Sổ thu chi: số dư có cộng đúng không, số dư đầu tháng có nối với cuối tháng trước không, bút toán bất thường,
// và chi trả khách theo ngày có khớp giữa sổ thu chi, danh sách chuyển khoản và tab tổng hợp theo ngày không.

import type { EvidenceRow } from "@/lib/types";
import { dayDiff } from "@/lib/util/values";
import { SHOP } from "../config";
import { parseBatch } from "../keys";
import type { LedgerRow, LedgerTable } from "../types";
import type { ShopBook } from "./book";
import { CheckBuilder, type ModuleOut, type Shared, dmy, emptyOut, monthOfIso, severityByAmount, sum, topByAmount, vnd } from "./helpers";

/** Tổng các khoản chi của một dòng sổ (mọi cột làm giảm số dư). */
const outflow = (r: LedgerRow): number => r.paid + r.salary + r.utilities + r.purchases + r.otherExpense + r.refund;
const net = (r: LedgerRow): number => r.received - outflow(r);

/** Tháng và năm của một tab theo tên tab ("926 - THÔNG TIN NHẬN TIỀN", "926" → 9/2026). */
export function tabYm(t: { src: { sheet: string } }): { year: number; month: number } | null {
  const m = /^\s*(\d{3,4})/.exec(t.src.sheet);
  return m ? parseBatch(m[1]) : null;
}

/** Tháng (1..12) của tab trong năm kiểm, hoặc null nếu tab thuộc năm khác. */
export function tabMonth(t: { src: { sheet: string } }, year: number): number | null {
  const ym = tabYm(t);
  return ym && ym.year === year ? ym.month : null;
}

export { net as ledgerNet, outflow as ledgerOutflow };

const tabIndex = (t: LedgerTable): number => {
  const ym = tabYm(t);
  return ym ? ym.year * 12 + ym.month : Number.MAX_SAFE_INTEGER;
};

/** Dòng không thuộc dãy ngày tăng dần dài nhất: nhiều khả năng ngày bị gõ sai. */
function outOfOrder(rows: LedgerRow[]): Set<number> {
  const dated = rows.map((r, i) => ({ i, d: r.date })).filter((x): x is { i: number; d: string } => !!x.d);
  const n = dated.length;
  const len = new Array<number>(n).fill(1);
  const prev = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (dated[j].d <= dated[i].d && len[j] + 1 > len[i]) {
        len[i] = len[j] + 1;
        prev[i] = j;
      }
    }
  }
  let best = 0;
  for (let i = 1; i < n; i++) if (len[i] > len[best]) best = i;
  const keep = new Set<number>();
  for (let i = n > 0 ? best : -1; i >= 0; i = prev[i]) keep.add(dated[i].i);
  const odd = new Set<number>();
  for (const x of dated) if (!keep.has(x.i)) odd.add(x.i);
  return odd;
}

interface Pair {
  from: string;
  to: string;
  amount: number;
}

/**
 * Ghép số dư dương và âm ở các ngày khác nhau: một khoản chỉ bị ghi lệch ngày giữa hai sổ.
 * Ghép chính xác trước; sau đó ghép gần đúng (chênh dưới 10%) và để phần chênh lại ở ngày muộn hơn như một lệch số tiền riêng.
 */
function pairShifts(res: Map<string, number>, tol: number): { pairs: Pair[]; rest: Map<string, number> } {
  const rest = new Map(res);
  const pairs: Pair[] = [];
  for (const mode of ["exact", "near"] as const) {
    const pos = [...rest.entries()].filter(([, v]) => v > tol).sort((a, b) => a[0].localeCompare(b[0]));
    const neg = [...rest.entries()].filter(([, v]) => v < -tol).sort((a, b) => a[0].localeCompare(b[0]));
    const usedNeg = new Set<number>();
    for (const [d1, v1] of pos) {
      let best = -1;
      let bestGap = Infinity;
      neg.forEach(([d2, v2], i) => {
        if (usedNeg.has(i)) return;
        const diff = Math.abs(v1 + v2);
        const ok = mode === "exact" ? diff <= tol : diff <= Math.max(tol, 0.1 * Math.max(Math.abs(v1), Math.abs(v2))) && Math.min(v1, -v2) >= 1_000_000;
        if (!ok) return;
        const gap = Math.abs(dayDiff(d1, d2));
        if (gap <= 62 && gap < bestGap) {
          best = i;
          bestGap = gap;
        }
      });
      if (best < 0) continue;
      usedNeg.add(best);
      const [d2, v2] = neg[best];
      const moved = Math.min(v1, -v2);
      pairs.push({ from: d1, to: d2, amount: moved });
      // Phần dư sau khi trừ khoản dời ngày: giữ lại ở ngày của phía lớn hơn để báo như lệch số tiền.
      const left1 = v1 - moved;
      const left2 = v2 + moved;
      if (Math.abs(left1) > tol) rest.set(d1, left1);
      else rest.delete(d1);
      if (Math.abs(left2) > tol) rest.set(d2, left2);
      else rest.delete(d2);
    }
  }
  return { pairs, rest };
}

export function ledgerChecks(b: ShopBook, sh: Shared): ModuleOut {
  const out = emptyOut();
  const { ev } = sh;
  const tol = SHOP.tolerance;

  const footCk = new CheckBuilder("ledger.footing", "ledger", "Sổ thu chi: số dư cộng đúng");
  const contCk = new CheckBuilder("ledger.continuity", "ledger", "Số dư đầu tháng nối với cuối tháng trước");
  const entryCk = new CheckBuilder("ledger.entries", "ledger", "Bút toán hợp lệ (ngày, ô ngoài sổ, số dư âm, ghi trùng)");
  const dayCk = new CheckBuilder("ledger.days", "ledger", "Chi trả theo ngày: sổ = danh sách CK = tab tổng hợp");

  const tables = [...b.ledgers].sort((a, c) => tabIndex(a) - tabIndex(c));
  const bankDebits = b.bank.filter((r) => (r.debit ?? 0) > 0 && r.date);

  // ------------------------------------------------------------ số dư cộng đúng
  const breaks: EvidenceRow[] = [];
  let breakSum = 0;
  let rowsJudged = 0;
  for (const t of tables) {
    let prevBalance = t.opening?.balance;
    for (const r of t.rows) {
      if (r.balance === undefined) continue;
      if (prevBalance !== undefined && r.date && r.date >= b.from) {
        rowsJudged++;
        const m = monthOfIso(r.date, b.year);
        footCk.judged(m);
        const expected = prevBalance + net(r);
        const diff = r.balance - expected;
        if (Math.abs(diff) > tol) {
          breakSum += Math.abs(diff);
          const omitted = r.omittedFromFormula.length > 0 ? ` Công thức số dư bỏ sót ô ${r.omittedFromFormula.join(", ")}.` : "";
          const foreign = r.foreignRefs.length > 0 ? ` Công thức tham chiếu ô lạ ${r.foreignRefs.join(", ")}.` : "";
          const hard = r.balanceFormula === undefined ? " Số dư là số gõ tay, không có công thức." : "";
          breaks.push(
            ev.row(t.src, r.row, {
              date: r.date,
              description: `Tab "${t.src.sheet}" dòng ${r.row}: số dư ghi ${vnd(r.balance)}, tính từ số dư trước ${vnd(prevBalance)} cộng nhận ${vnd(r.received)} trừ chi ${vnd(outflow(r))} được ${vnd(expected)}`,
              amount: Math.abs(diff),
              balance: r.balance,
              note: `Lệch ${vnd(diff)}đ.${omitted}${foreign}${hard}`,
            }),
          );
          footCk.issue(m, Math.abs(diff));
        }
      }
      prevBalance = r.balance;
    }
  }
  if (breaks.length > 0) {
    out.drafts.push({
      rule: "ledger_footing",
      // Số dư lệch ở một dòng thường bị bù ở dòng kế tiếp (công thức trỏ vào số dư dòng trước), nên chỉ lên Cao khi lệch lớn.
      severity: severityByAmount(breakSum, 5_000_000, 500_000),
      title: `Số dư sổ thu chi không khớp phép tính: ${breaks.length} dòng, lệch ${vnd(breakSum)}đ`,
      description:
        `${breaks.length} dòng trong sổ thu chi có số dư "còn lại" khác số dư trước cộng tiền nhận trừ các khoản chi. ` +
        `Nguyên nhân thường gặp là công thức số dư bỏ sót một ô chi (chèn dòng, kéo công thức sai) hoặc số dư bị gõ đè.`,
      recommendation: "Sửa công thức số dư của dòng lệch cho cộng đủ mọi ô chi, rồi xem lại các dòng phía sau vì số dư trôi theo.",
      records: [],
      evidenceOverride: topByAmount(breaks),
      total: breaks.length,
      amount: breakSum,
    });
  }
  out.checks.push(footCk.build(breaks.length === 0 ? `${rowsJudged} dòng số dư đều cộng đúng` : `${breaks.length}/${rowsJudged} dòng số dư lệch`));

  // ------------------------------------------------------------ nối số dư giữa các tháng
  const cont: EvidenceRow[] = [];
  let contSum = 0;
  for (let i = 1; i < tables.length; i++) {
    const a = tables[i - 1];
    const c = tables[i];
    const mc = tabMonth(c, b.year);
    if (mc === null || tabIndex(c) !== tabIndex(a) + 1) continue;
    const closing = a.rows[a.rows.length - 1]?.balance;
    const first = c.rows[0];
    const opening = c.opening?.balance ?? (first?.balance !== undefined ? first.balance - net(first) : undefined);
    if (closing === undefined || opening === undefined) continue;
    contCk.judged(mc);
    const diff = opening - closing;
    if (Math.abs(diff) > tol) {
      contSum += Math.abs(diff);
      const row = c.opening?.row ?? first?.row ?? 1;
      // Tab sau thường "mở" bằng một số dư nằm giữa tab trước: các dòng sau đó của tab trước không được chuyển sang.
      let why = "";
      const at = a.rows.findIndex((r) => r.balance !== undefined && Math.abs(r.balance - opening) <= tol);
      if (at >= 0 && at < a.rows.length - 1) {
        const skipped = a.rows.slice(at + 1);
        why =
          ` Số mở của tab sau bằng số dư dòng ${a.rows[at].row} (${dmy(a.rows[at].date)}) của tab trước, tức ${skipped.length} dòng cuối của tab trước ` +
          `(${dmy(skipped[0].date)}${skipped.length > 1 ? ` đến ${dmy(skipped[skipped.length - 1].date)}` : ""}, ròng ${vnd(sum(skipped.map(net)))}đ) không được chuyển sang.`;
        // Nếu chính các dòng bị bỏ lại được ghi lại ở tab sau (cùng ngày, cùng số nhận), thì không phải tiền biến mất mà là cùng một ngày
        // nằm ở hai tab với số liệu khác nhau.
        const again = skipped.filter((s) => s.received > 0 && c.rows.some((x) => x.date === s.date && x.received === s.received));
        if (again.length > 0) {
          why +=
            ` Nhưng ${again.length === skipped.length ? "toàn bộ" : `${again.length}/${skipped.length}`} các dòng đó có khoản nhận được ghi lại ở tab sau (${again.map((s) => `${dmy(s.date)} nhận ${vnd(s.received)}đ`).join("; ")}), ` +
            `nên đây là cùng một ngày bị ghi ở hai tab, không hẳn là tiền biến mất: số nhận và số chi của ngày đó bị tính hai lần trong tổng hai tháng (xem phát hiện "cùng một khoản ghi ở hai tab").`;
        }
      }
      cont.push(
        ev.row(c.src, row, {
          date: c.opening?.date ?? first?.date,
          description: `Tab "${a.src.sheet}" kết thúc với số dư ${vnd(closing)}, nhưng tab "${c.src.sheet}" mở với ${vnd(opening)}`,
          amount: Math.abs(diff),
          balance: opening,
          note: `${diff < 0 ? "Mất" : "Phát sinh thêm"} ${vnd(Math.abs(diff))}đ giữa hai tháng mà không có bút toán.${why}`,
        }),
      );
      contCk.issue(mc, Math.abs(diff));
    }
  }
  if (cont.length > 0) {
    out.drafts.push({
      rule: "ledger_continuity",
      severity: severityByAmount(contSum, 5_000_000, 500_000),
      title: `Số dư đầu tháng không nối với cuối tháng trước: ${cont.length} chỗ, ${vnd(contSum)}đ`,
      description:
        `Sổ thu chi mỗi tháng là một tab riêng; số dư cuối tab tháng trước phải bằng số dư đầu tab tháng sau. ${cont.length} chỗ không khớp, tổng chênh ${vnd(contSum)}đ. ` +
        `Báo cáo tháng cũng lấy "còn lại" của tháng trước nên sai theo nếu số mở đầu bị đổi.`,
      recommendation: "Tìm lý do số dư đầu tháng bị đổi (rút tiền, chuyển quỹ, sửa tay). Nếu không có chứng từ, đó là khoản thất thoát hoặc ghi thiếu.",
      records: [],
      evidenceOverride: topByAmount(cont),
      total: cont.length,
      amount: contSum,
    });
  }
  out.checks.push(contCk.build(cont.length === 0 ? "số dư các tháng nối liên tục" : `${cont.length} chỗ đứt, tổng ${vnd(contSum)}đ`));

  // ------------------------------------------------------------ bút toán bất thường
  const orphanRows: EvidenceRow[] = [];
  let orphanSum = 0;
  const negRows: EvidenceRow[] = [];
  const dateRows: EvidenceRow[] = [];
  const dupRows: EvidenceRow[] = [];
  let dupSum = 0;

  for (const t of tables) {
    for (const o of t.orphans) {
      const m = tabMonth(t, b.year);
      entryCk.judged(m);
      orphanSum += Math.abs(o.value);
      orphanRows.push(
        ev.row(t.src, o.row, {
          reference: o.addr,
          description: `Tab "${t.src.sheet}" ô ${o.addr} có ${vnd(o.value)} nhưng dòng không có số dư: ô nằm ngoài sổ${o.formula ? ` (công thức ${o.formula})` : ""}`,
          amount: Math.abs(o.value),
        }),
      );
      entryCk.issue(m, Math.abs(o.value));
    }
    const odd = outOfOrder(t.rows);
    t.rows.forEach((r, i) => {
      const m = monthOfIso(r.date, b.year) ?? tabMonth(t, b.year);
      if (r.date && r.date >= b.from) entryCk.judged(m);
      if (r.balance !== undefined && r.balance < 0 && r.date && r.date >= b.from) {
        negRows.push(
          ev.row(t.src, r.row, {
            date: r.date,
            description: `Tab "${t.src.sheet}" dòng ${r.row}: số dư còn lại âm ${vnd(r.balance)}`,
            amount: Math.abs(r.balance),
            balance: r.balance,
            note: "Đã chi nhiều hơn số tiền đang giữ: thiếu một khoản nhận chưa ghi hoặc chi vượt",
          }),
        );
        entryCk.issue(m, Math.abs(r.balance));
      }
      const future = r.date !== undefined && r.date > b.today;
      if (r.date && (odd.has(i) || future) && r.date >= b.from) {
        dateRows.push(
          ev.row(t.src, r.row, {
            date: r.date,
            description: `Tab "${t.src.sheet}" dòng ${r.row}: ngày ${dmy(r.date)} ${future ? "ở tương lai" : "không nằm đúng thứ tự so với các dòng quanh nó"}`,
            amount: Math.max(r.received, outflow(r)),
            note: `Nhận ${vnd(r.received)}, chi ${vnd(outflow(r))}. Nhiều khả năng gõ nhầm ngày`,
          }),
        );
        entryCk.issue(m, 0);
      }
    });
  }

  // cùng ngày, cùng số tiền (từ 1 triệu) nhưng nằm ở hai tab khác nhau
  const seen = new Map<string, { t: LedgerTable; r: LedgerRow; kind: string }[]>();
  for (const t of tables) {
    for (const r of t.rows) {
      if (!r.date || r.date < b.from) continue;
      for (const [kind, v] of [
        ["nhận", r.received],
        ["trả khách", r.paid],
      ] as const) {
        if (v < 1_000_000) continue;
        const k = `${r.date}|${kind}|${v}`;
        const list = seen.get(k) ?? [];
        list.push({ t, r, kind });
        seen.set(k, list);
      }
    }
  }
  for (const [k, list] of seen) {
    const tabs = new Set(list.map((x) => x.t.src.sheet));
    if (tabs.size < 2) continue;
    const [, kind, v] = k.split("|");
    const amount = Number(v);
    dupSum += amount * (list.length - 1);
    const m = monthOfIso(list[0].r.date, b.year);
    entryCk.issue(m, amount * (list.length - 1));
    // Với khoản nhận, sao kê cho biết tiền thật đã ra mấy lần.
    let bankNote = "";
    if (kind === "nhận" && bankDebits.length > 0) {
      const date = list[0].r.date as string;
      const hits = bankDebits.filter((x) => x.debit === amount && Math.abs(dayDiff(x.date as string, date)) <= SHOP.bankWindowDays);
      bankNote = hits.length > 0 ? ` Sao kê có ${hits.length} lệnh chuyển ${vnd(amount)} trong ±${SHOP.bankWindowDays} ngày` : " Sao kê không có lệnh chuyển cùng số tiền";
      bankNote += hits.length < list.length ? `, ít hơn số lần sổ ghi (${list.length}).` : ".";
    }
    dupRows.push(
      ev.row(list[0].t.src, list[0].r.row, {
        date: list[0].r.date,
        description: `Khoản ${kind} ${vnd(amount)} ngày ${dmy(list[0].r.date)} xuất hiện ở ${tabs.size} tab`,
        amount,
        note: `${list.map((x) => `${x.t.src.sheet} dòng ${x.r.row}`).join(" ; ")}.${bankNote}`,
      }),
    );
  }

  const negSum = sum(negRows.map((r) => r.amount));
  const negMax = negRows.reduce((mx, r) => Math.max(mx, r.amount), 0);
  if (orphanRows.length > 0) {
    out.drafts.push({
      rule: "ledger_entry_issue",
      // Ô nằm ngoài sổ không làm đổi số dư nào nên không lên Cao dù số tiền lớn.
      severity: severityByAmount(orphanSum, Infinity, 1_000_000),
      title: `Ô số liệu nằm ngoài sổ thu chi: ${orphanRows.length} ô, ${vnd(orphanSum)}đ`,
      description: `${orphanRows.length} ô có tiền nhưng thuộc dòng không có số dư còn lại, nên không được cộng vào số dư nào. Thường là ô tính nháp để lại trong sổ, nhưng cũng có thể là khoản chi/nhận bị bỏ khỏi sổ.`,
      recommendation: "Xác định từng ô: nếu là khoản thật thì đưa vào một dòng của sổ, nếu là nháp thì xóa.",
      records: [],
      evidenceOverride: topByAmount(orphanRows),
      total: orphanRows.length,
      amount: orphanSum,
    });
  }
  if (negRows.length > 0) {
    out.drafts.push({
      rule: "ledger_entry_issue",
      severity: severityByAmount(negMax, 20_000_000, 2_000_000),
      title: `Số dư sổ thu chi âm: ${negRows.length} dòng, âm nhiều nhất ${vnd(negMax)}đ`,
      description: `${negRows.length} dòng có số dư còn lại âm (nhiều nhất ${vnd(negMax)}đ, cộng dồn ${vnd(negSum)}đ). Quản lý không thể chi nhiều hơn số tiền đang giữ, nên hoặc đã ứng tiền riêng, thiếu một khoản nhận chưa ghi, hoặc có khoản chi sai.`,
      recommendation: "Đối chiếu sao kê quanh ngày đó để tìm khoản nhận bị thiếu.",
      records: [],
      evidenceOverride: topByAmount(negRows),
      total: negRows.length,
      amount: negSum,
    });
  }
  if (dateRows.length > 0) {
    out.drafts.push({
      rule: "ledger_entry_issue",
      severity: "medium",
      title: `Ngày trong sổ thu chi sai thứ tự: ${dateRows.length} dòng`,
      description: `${dateRows.length} dòng có ngày lệch khỏi dãy ngày tăng dần của tab (hoặc sau ngày dữ liệu mới nhất). Sổ ghi theo thứ tự thời gian nên đây thường là gõ nhầm ngày, làm khoản tiền rơi vào sai ngày khi đối chiếu sao kê.`,
      recommendation: "Sửa ngày theo chứng từ; xem sao kê để biết ngày đúng.",
      records: [],
      evidenceOverride: dateRows,
      total: dateRows.length,
      amount: sum(dateRows.map((r) => r.amount)),
    });
  }
  if (dupRows.length > 0) {
    out.drafts.push({
      rule: "ledger_entry_issue",
      severity: severityByAmount(dupSum, 10_000_000, 1_000_000),
      title: `Cùng một khoản ghi ở hai tab sổ thu chi: ${dupRows.length} khoản, ${vnd(dupSum)}đ`,
      description: `${dupRows.length} khoản có cùng ngày, cùng số tiền (từ 1 triệu) nằm ở hai tab khác nhau. Nếu là một giao dịch bị chép đôi thì số nhận/chi của cả hai tháng đều thổi phồng.`,
      recommendation: "Đối chiếu sao kê đúng ngày: nếu chỉ có một lệnh chuyển, xóa dòng thừa và tính lại số dư.",
      records: [],
      evidenceOverride: topByAmount(dupRows),
      total: dupRows.length,
      amount: dupSum,
    });
  }
  const entryTotal = orphanRows.length + negRows.length + dateRows.length + dupRows.length;
  out.checks.push(
    entryCk.build(
      entryTotal === 0
        ? "không có bút toán bất thường"
        : `${orphanRows.length} ô ngoài sổ, ${negRows.length} dòng số dư âm, ${dateRows.length} dòng sai ngày, ${dupRows.length} khoản ghi hai tab`,
    ),
  );

  // ------------------------------------------------------------ chi trả theo ngày: ba nguồn
  const led = new Map<string, number>();
  const ck = new Map<string, number>();
  const summ = new Map<string, number>();
  const add = (m: Map<string, number>, d: string | undefined, v: number): void => {
    if (!d || d < b.from) return;
    m.set(d, (m.get(d) ?? 0) + v);
  };
  for (const t of b.ledgers) for (const r of t.rows) add(led, r.date, r.paid);
  for (const p of b.payouts) add(ck, p.date, p.amount);
  for (const t of b.daySummaries) for (const r of t.rows) add(summ, r.date, r.current + r.previous);

  const haveLed = led.size > 0;
  const haveCk = ck.size > 0;
  const haveSum = summ.size > 0;
  if ([haveLed, haveCk, haveSum].filter(Boolean).length >= 2) {
    const days = [...new Set([...led.keys(), ...ck.keys(), ...summ.keys()])].sort();
    // Danh sách chuyển khoản là sổ chi tiết từng dòng nên làm chuẩn; hai sổ còn lại được so với nó theo từng ngày.
    const resLed = new Map<string, number>();
    const resSum = new Map<string, number>();
    for (const d of days) {
      if (haveLed) resLed.set(d, (led.get(d) ?? 0) - (ck.get(d) ?? 0));
      if (haveSum) resSum.set(d, (summ.get(d) ?? 0) - (ck.get(d) ?? 0));
      dayCk.judged(monthOfIso(d, b.year));
    }
    const sl = pairShifts(resLed, tol);
    const ss = pairShifts(resSum, tol);

    const shiftRows: EvidenceRow[] = [];
    let shiftSum = 0;
    const key = (p: Pair): string => `${p.from}|${p.to}|${p.amount}`;
    const sumByKey = new Map(ss.pairs.map((p) => [key(p), p] as const));
    const handled = new Set<string>();
    const shiftPairs: Pair[] = [];
    const mkShift = (p: Pair, who: string): void => {
      shiftPairs.push(p);
      shiftSum += p.amount;
      const m = monthOfIso(p.from, b.year);
      dayCk.issue(m, p.amount);
      const src = b.payoutTables[0]?.src ?? b.ledgers[0]?.src;
      if (!src) return;
      shiftRows.push(
        ev.row(src, 1, {
          date: p.from,
          description: `${vnd(p.amount)}đ: ${who} ghi ngày ${dmy(p.from)}, danh sách chuyển khoản ghi ngày ${dmy(p.to)}`,
          amount: p.amount,
          note: `Lệch ${Math.abs(dayDiff(p.from, p.to))} ngày`,
        }),
      );
    };
    for (const p of sl.pairs) {
      const twin = sumByKey.get(key(p));
      if (twin) handled.add(key(p));
      mkShift(p, twin ? "sổ thu chi và tab tổng hợp ngày" : "sổ thu chi");
    }
    for (const p of ss.pairs) if (!handled.has(key(p))) mkShift(p, "tab tổng hợp ngày");

    const restDays = new Set<string>([...sl.rest.entries()].filter(([, v]) => Math.abs(v) > tol).map(([d]) => d));
    for (const [d, v] of ss.rest) if (Math.abs(v) > tol) restDays.add(d);
    const amountRows: EvidenceRow[] = [];
    const smallRows: EvidenceRow[] = [];
    let amountSum = 0;
    let amountMax = 0;
    let smallSum = 0;
    const SMALL = 100_000;
    for (const d of [...restDays].sort()) {
      const l = led.get(d) ?? 0;
      const c = ck.get(d) ?? 0;
      const s = summ.get(d) ?? 0;
      // Phần dư sau khi đã xếp các khoản dời ngày: đây mới là độ lệch thật của ngày.
      const rl = sl.rest.get(d) ?? 0;
      const rs = ss.rest.get(d) ?? 0;
      const spread = Math.max(Math.abs(rl), Math.abs(rs));
      dayCk.issue(monthOfIso(d, b.year), spread);
      const src = b.payoutTables[0]?.src ?? b.ledgers[0]?.src;
      if (!src) continue;
      const moved = Math.abs(rl - (l - c)) > tol || Math.abs(rs - (s - c)) > tol;
      const row = ev.row(src, 1, {
        date: d,
        description: `Ngày ${dmy(d)}: sổ thu chi ${haveLed ? vnd(l) : "-"} · danh sách CK ${vnd(c)} · tab tổng hợp ${haveSum ? vnd(s) : "-"}`,
        amount: spread,
        note:
          `Sổ thu chi ${rl >= 0 ? "+" : ""}${vnd(rl)} so với CK; tab tổng hợp ${rs >= 0 ? "+" : ""}${vnd(rs)} so với CK` +
          (moved ? " (sau khi đã trừ các khoản chỉ bị ghi lệch ngày, xem phát hiện riêng)" : ""),
      });
      if (spread >= SMALL) {
        amountRows.push(row);
        amountSum += spread;
        amountMax = Math.max(amountMax, spread);
      } else {
        smallRows.push(row);
        smallSum += spread;
      }
    }
    if (amountRows.length > 0) {
      out.drafts.push({
        rule: "day_mismatch",
        // Các ngày lệch thường cùng một nguyên nhân (một khoản bị dời ngày kéo theo hai ngày lệch), nên xếp mức theo ngày lệch lớn nhất.
        severity: severityByAmount(amountMax, 20_000_000, 1_000_000),
        title: `Chi trả theo ngày lệch số tiền giữa các sổ: ${amountRows.length} ngày, lệch lớn nhất ${vnd(amountMax)}đ`,
        description:
          `Tổng tiền trả khách trong một ngày phải bằng nhau ở sổ thu chi, danh sách chuyển khoản và tab tổng hợp theo ngày. ${amountRows.length} ngày lệch từ ${vnd(SMALL)}đ trở lên (không phải chỉ lệch ngày ghi), ` +
          `cộng các độ lệch ${vnd(amountSum)}đ (một khoản bị ghi sai ngày có thể làm lệch hai ngày liên tiếp nên con số này có tính trùng). ` +
          `Thường là một dòng được thêm/sửa ở một sổ mà không cập nhật các sổ còn lại.`,
        recommendation: "Với từng ngày, so ba sổ và sao kê để xác định số đúng, rồi sửa hai sổ còn lại.",
        records: [],
        evidenceOverride: topByAmount(amountRows),
        total: amountRows.length,
        amount: amountSum,
      });
    }
    if (smallRows.length > 0) {
      out.drafts.push({
        rule: "day_mismatch",
        severity: "low",
        title: `Chi trả theo ngày lệch nhỏ (dưới ${vnd(SMALL)}đ): ${smallRows.length} ngày, ${vnd(smallSum)}đ`,
        description: `${smallRows.length} ngày có tổng trả khách lệch dưới ${vnd(SMALL)}đ giữa các sổ, thường do gõ nhầm hàng nghìn ở một dòng. Số nhỏ nhưng cho thấy một sổ được nhập tay độc lập với sổ kia.`,
        recommendation: "Sửa theo danh sách chuyển khoản; cân nhắc dùng công thức để tab tổng hợp tự lấy từ danh sách này.",
        records: [],
        evidenceOverride: topByAmount(smallRows),
        total: smallRows.length,
        amount: smallSum,
      });
    }
    if (shiftRows.length > 0) {
      // Dời ngày vài ngày chỉ làm số theo ngày không khớp; dời sang tháng khác (từ 28 ngày) mới làm sai tổng tháng.
      const longShift = shiftPairs.filter((p) => Math.abs(dayDiff(p.from, p.to)) >= 28);
      const longMax = longShift.reduce((mx, p) => Math.max(mx, p.amount), 0);
      out.drafts.push({
        rule: "day_mismatch",
        severity: longMax >= 50_000_000 ? "high" : longShift.length > 0 || shiftSum >= 100_000_000 ? "medium" : "low",
        title: `Khoản tiền bị ghi lệch ngày giữa các sổ: ${shiftRows.length} khoản, ${vnd(shiftSum)}đ`,
        description:
          `${shiftRows.length} khoản có cùng số tiền nhưng sổ thu chi hoặc tab tổng hợp ghi ở một ngày, danh sách chuyển khoản ghi ở ngày khác. ` +
          `Tổng ngày vẫn đủ nếu gộp theo tháng nhưng đối chiếu sao kê từng ngày sẽ không khớp, và khoản gần cuối tháng có thể rơi sang tháng khác.`,
        recommendation: "Thống nhất một ngày chuyển thực tế (theo sao kê) cho cả ba sổ.",
        records: [],
        evidenceOverride: topByAmount(shiftRows),
        total: shiftRows.length,
        amount: shiftSum,
      });
    }
    out.checks.push(
      dayCk.build(
        shiftRows.length + amountRows.length === 0
          ? `${days.length} ngày có chi trả, ba sổ khớp nhau`
          : `${days.length} ngày có chi trả: ${shiftRows.length} khoản ghi lệch ngày, ${amountRows.length} ngày lệch từ ${vnd(SMALL)}đ, ${smallRows.length} ngày lệch nhỏ`,
      ),
    );
  }

  // ------------------------------------------------------------ số liệu theo tháng
  const recvByTab: Record<number, number> = {};
  const paidByTab: Record<number, number> = {};
  const closeByTab: Record<number, number> = {};
  for (const t of tables) {
    const m = tabMonth(t, b.year);
    if (m === null) continue;
    recvByTab[m] = sum(t.rows.map((r) => r.received));
    paidByTab[m] = sum(t.rows.map((r) => r.paid));
    const last = t.rows[t.rows.length - 1]?.balance;
    if (last !== undefined) closeByTab[m] = last;
  }
  out.figures.push(
    { id: "fig.ledger_recv", label: "Tiền nhận", source: "Sổ thu chi (theo tab tháng)", months: recvByTab },
    { id: "fig.ledger_paid", label: "Đã trả khách", source: "Sổ thu chi (theo tab tháng)", months: paidByTab },
    { id: "fig.ledger_close", label: "Số dư cuối tháng", source: "Sổ thu chi", months: closeByTab },
  );
  return out;
}
