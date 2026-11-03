// Báo cáo tháng và doanh thu ngày: các con số trong báo cáo tháng có khớp sổ gốc không, báo cáo có cộng đúng không,
// và doanh thu từng ngày có bằng tổng các hình thức thu không.

import type { EvidenceRow } from "@/lib/types";
import { SHOP } from "../config";
import { parseBatch } from "../keys";
import type { MonthlyRow, SrcRef } from "../types";
import type { ShopBook } from "./book";
import { CheckBuilder, type ModuleOut, type Shared, dmy, emptyOut, severityByAmount, sum, topByAmount, vnd } from "./helpers";
import { ledgerOutflow, tabMonth } from "./ledger";

export function reportChecks(b: ShopBook, sh: Shared): ModuleOut {
  const out = emptyOut();
  const { ev } = sh;
  const tol = SHOP.tolerance;

  // ------------------------------------------------------------ nguồn gốc theo tháng
  const lotsOwed = new Map<number, number>();
  for (const t of b.lotTables) {
    const bi = t.mainBatch ? parseBatch(t.mainBatch) : null;
    if (bi && bi.year === b.year) lotsOwed.set(bi.month, sum(t.rows.filter((r) => r.batch === t.mainBatch).map((r) => r.owed)));
  }
  const dayHead = new Map<number, { value: number; addr: string; src: SrcRef; row: number; label: string }>();
  const labelQuirks: EvidenceRow[] = [];
  for (const t of b.daySummaries) {
    const m = tabMonth(t, b.year);
    if (m === null) continue;
    const head = t.declared.filter((d) => d.field === "current").sort((x, y) => x.row - y.row)[0];
    if (head) dayHead.set(m, { value: head.value, addr: head.addr, src: t.src, row: head.row, label: t.src.sheet });
    const nameBatch = /^\s*(\d{3,4})/.exec(t.src.sheet)?.[1];
    if (nameBatch && t.batch && t.batch !== nameBatch) {
      labelQuirks.push(
        ev.row(t.src, t.headerRow + 1, {
          description: `Tab "${t.src.sheet}": tiêu đề cột ghi "Tháng ${t.batch}" nhưng tab là của đợt ${nameBatch}`,
          amount: 0,
          note: "Chỉ là nhãn, nhưng người đọc hoặc công thức tra theo nhãn cột có thể lấy nhầm đợt",
        }),
      );
    }
  }
  interface LedgerMonth {
    received: number;
    paid: number;
    other: number;
    opening?: number;
    closing?: number;
    src: SrcRef;
    /** Lũy kế (cả số dư đầu) đến hết từng ngày của tab, để nhận ra báo cáo lập giữa chừng. */
    cumulative: { date: string; received: number; paid: number; balance: number }[];
  }
  const ledgerByMonth = new Map<number, LedgerMonth>();
  for (const t of b.ledgers) {
    const m = tabMonth(t, b.year);
    if (m === null) continue;
    const open = t.opening?.balance ?? 0;
    const cumulative: LedgerMonth["cumulative"] = [];
    let cr = open;
    let cp = 0;
    for (const r of t.rows) {
      cr += r.received;
      cp += r.paid;
      if (!r.date || r.balance === undefined) continue;
      const last = cumulative[cumulative.length - 1];
      if (last && last.date === r.date) {
        last.received = cr;
        last.paid = cp;
        last.balance = r.balance;
      } else cumulative.push({ date: r.date, received: cr, paid: cp, balance: r.balance });
    }
    ledgerByMonth.set(m, {
      received: sum(t.rows.map((r) => r.received)),
      paid: sum(t.rows.map((r) => r.paid)),
      other: sum(t.rows.map((r) => ledgerOutflow(r) - r.paid)),
      opening: t.opening?.balance,
      closing: t.rows[t.rows.length - 1]?.balance,
      src: t.src,
      cumulative,
    });
  }
  const timing: EvidenceRow[] = [];
  const openingGuess: string[] = [];
  const revenueByMonth = new Map<number, number>();
  for (const t of b.revenues) if (t.year === b.year) revenueByMonth.set(t.month, sum(t.rows.map((r) => r.revenue)));

  // ------------------------------------------------------------ báo cáo tháng
  const rows = new Map<number, { row: MonthlyRow; src: SrcRef }>();
  for (const { table } of b.monthly) for (const r of table.rows) if (!rows.has(r.month)) rows.set(r.month, { row: r, src: table.src });

  const owedCk = new CheckBuilder("report.owed", "report", "Tổng trả khách khớp bảng lô và tab tổng hợp ngày");
  const ledgerCk = new CheckBuilder("report.ledger", "report", "Báo cáo tháng: nhận / đã trả / còn lại = sổ thu chi");
  const footCk = new CheckBuilder("report.footing", "report", "Báo cáo tháng: còn lại = nhận − trả − chi phí − hoàn trả");
  const revCk = new CheckBuilder("report.revenue", "report", "Báo cáo tháng: doanh thu = tổng doanh thu ngày");

  const owedRows: EvidenceRow[] = [];
  const ledgerRows: EvidenceRow[] = [];
  const footRows: EvidenceRow[] = [];
  const revRows: EvidenceRow[] = [];
  let owedSum = 0;
  let ledgerSum = 0;
  let footSum = 0;
  let revSum = 0;
  const missingRevenue: number[] = [];

  const cmp = (
    ck: CheckBuilder,
    bucket: EvidenceRow[],
    month: number,
    src: SrcRef,
    rowNo: number,
    label: string,
    reported: number | undefined,
    actual: number | undefined,
    actualLabel: string,
  ): number => {
    if (reported === undefined || actual === undefined) return 0;
    ck.judged(month);
    const d = reported - actual;
    if (Math.abs(d) <= tol) return 0;
    bucket.push(
      ev.row(src, rowNo, {
        description: `Tháng ${month}: báo cáo ghi ${label} ${vnd(reported)}, ${actualLabel} là ${vnd(actual)}`,
        amount: Math.abs(d),
        note: `Báo cáo ${d > 0 ? "cao hơn" : "thấp hơn"} ${vnd(Math.abs(d))}đ`,
      }),
    );
    ck.issue(month, Math.abs(d));
    return Math.abs(d);
  };

  for (const [m, { row, src }] of [...rows.entries()].sort((x, y) => x[0] - y[0])) {
    // --- tổng trả khách: bảng lô là gốc, tab tổng hợp ngày là gốc thứ hai khi không có bảng lô
    const lots = lotsOwed.get(m);
    const head = dayHead.get(m);
    const authority = lots ?? head?.value;
    const authorityLabel = lots !== undefined ? "tổng các lô trong bảng lô" : "ô tổng đầu tab tổng hợp ngày";
    owedSum += cmp(owedCk, owedRows, m, src, row.row, "Tổng trả khách", row.owed, authority, authorityLabel);
    if (lots !== undefined && head) {
      owedCk.judged(m);
      const d = head.value - lots;
      if (Math.abs(d) > tol) {
        owedRows.push(
          ev.row(head.src, head.row, {
            reference: head.addr,
            description: `Tháng ${m}: tab "${head.label}" ô ${head.addr} ghi tổng ${vnd(head.value)}, tổng các lô trong bảng lô là ${vnd(lots)}`,
            amount: Math.abs(d),
            note: `Tab tổng hợp ngày ${d > 0 ? "cao hơn" : "thấp hơn"} bảng lô ${vnd(Math.abs(d))}đ: một trong hai chưa cập nhật`,
          }),
        );
        owedCk.issue(m, Math.abs(d));
        owedSum += Math.abs(d);
      }
    }

    // --- nhận / đã trả / còn lại so với sổ thu chi
    const led = ledgerByMonth.get(m);
    if (led) {
      // Báo cáo có thể được lập khi sổ chưa ghi hết tháng. Nếu các số của báo cáo trùng khít lũy kế của sổ đến hết một ngày
      // (nhận, trả và còn lại cùng khớp) thì đó là chênh do thời điểm lập, không phải sai số.
      // Một số tháng cộng số dư đầu vào "Tổng tiền nhận", tháng khác thì không (và cộng nó ở công thức "còn lại"): thử cả hai cách.
      const openAmt = led.opening ?? 0;
      const cut = led.cumulative.find(
        (c) =>
          (Math.abs(c.received - (row.received ?? NaN)) <= tol || Math.abs(c.received - openAmt - (row.received ?? NaN)) <= tol) &&
          Math.abs(c.paid - (row.paid ?? NaN)) <= tol &&
          (row.left === undefined || Math.abs(c.balance - row.left) <= tol),
      );
      const lastDate = led.cumulative[led.cumulative.length - 1]?.date;
      if (cut && lastDate && cut.date < lastDate) {
        ledgerCk.judged(m);
        timing.push(
          ev.row(src, row.row, {
            date: cut.date,
            description: `Tháng ${m}: báo cáo tháng lập khi sổ thu chi mới ghi đến hết ngày ${dmy(cut.date)}; sổ đã ghi thêm đến ${dmy(lastDate)}`,
            amount: Math.abs((led.closing ?? 0) - (row.left ?? 0)),
            note: `Nhận, trả và còn lại của báo cáo trùng khít lũy kế sổ đến ${dmy(cut.date)} (trả ${vnd(cut.paid)}, còn ${vnd(cut.balance)}); chưa cập nhật phần ${dmy(lastDate)}`,
          }),
        );
      } else {
        // "Tổng tiền nhận" của báo cáo gồm cả số dư chuyển sang đầu tháng; tab đầu năm không biết số này nên chỉ so khi biết.
        if (led.opening !== undefined) {
          ledgerSum += cmp(ledgerCk, ledgerRows, m, src, row.row, "Tổng tiền nhận (gồm số dư đầu)", row.received, led.received + led.opening, "nhận trong sổ + số dư đầu tháng");
        } else if (row.received !== undefined) {
          ledgerCk.judged(m);
          const d = row.received - led.received;
          if (d < -tol) {
            ledgerSum += Math.abs(d);
            ledgerRows.push(
              ev.row(src, row.row, {
                description: `Tháng ${m}: báo cáo ghi tổng tiền nhận ${vnd(row.received)}, thấp hơn tổng nhận trong sổ ${vnd(led.received)}`,
                amount: Math.abs(d),
                note: "Báo cáo không thể thấp hơn tiền nhận trong sổ dù cộng thêm số dư đầu tháng",
              }),
            );
            ledgerCk.issue(m, Math.abs(d));
          } else if (d > tol) {
            openingGuess.push(`tháng ${m}: báo cáo cao hơn sổ ${vnd(d)}đ (có thể là số dư chuyển sang đầu tháng)`);
          }
        }
        ledgerSum += cmp(ledgerCk, ledgerRows, m, src, row.row, "Tổng tiền đã trả", row.paid, led.paid, "tổng trả khách trong sổ");
        ledgerSum += cmp(ledgerCk, ledgerRows, m, src, row.row, "Số tiền còn lại", row.left, led.closing, "số dư cuối tháng trong sổ");
      }
    }

    // --- báo cáo có cộng đúng không (chỉ xét ô còn lại gõ tay; ô có công thức đã tự tính theo quy ước riêng của dòng đó)
    if (row.received !== undefined && row.paid !== undefined && row.expense !== undefined && row.refund !== undefined && row.left !== undefined && !row.leftFormula) {
      footCk.judged(m);
      const expected = row.received - row.paid - row.expense - row.refund;
      const d = row.left - expected;
      if (Math.abs(d) > tol) {
        footSum += Math.abs(d);
        footRows.push(
          ev.row(src, row.row, {
            description: `Tháng ${m}: nhận ${vnd(row.received)} − trả ${vnd(row.paid)} − chi phí ${vnd(row.expense)} − hoàn trả ${vnd(row.refund)} = ${vnd(expected)}, nhưng báo cáo ghi còn lại ${vnd(row.left)}`,
            amount: Math.abs(d),
            note: `Lệch ${vnd(d)}đ`,
          }),
        );
        footCk.issue(m, Math.abs(d));
      }
    }

    // --- doanh thu
    const rev = revenueByMonth.get(m);
    if (rev !== undefined) {
      if (row.revenue === undefined) {
        missingRevenue.push(m);
        revCk.judged(m);
        revCk.issue(m, 0);
      } else {
        revSum += cmp(revCk, revRows, m, src, row.row, "Doanh thu", row.revenue, rev, "tổng doanh thu theo ngày");
      }
    }
  }

  if (owedRows.length > 0) {
    out.drafts.push({
      rule: "report_mismatch",
      severity: severityByAmount(Math.max(...owedRows.map((r) => r.amount)), 10_000_000, 1_000_000),
      title: `Tổng trả khách lệch giữa báo cáo, bảng lô và tab tổng hợp ngày: ${owedRows.length} chỗ`,
      description:
        `Mỗi tháng có ba nơi ghi tổng tiền phải trả khách (báo cáo tháng, bảng lô, ô đầu tab tổng hợp ngày). ${owedRows.length} chỗ không bằng nhau, cộng các độ lệch ${vnd(owedSum)}đ. ` +
        `Báo cáo tháng là bảng chủ shop đọc nên con số sai ở đó dẫn đến quyết định sai.`,
      recommendation: "Lấy tổng tính từ bảng lô làm chuẩn, sửa công thức SUM nếu có lỗi, rồi để báo cáo tháng tham chiếu thẳng vào ô tổng thay vì gõ tay.",
      records: [],
      evidenceOverride: topByAmount(owedRows),
      total: owedRows.length,
      amount: owedSum,
    });
  }
  if (ledgerRows.length > 0) {
    out.drafts.push({
      rule: "report_mismatch",
      severity: severityByAmount(Math.max(...ledgerRows.map((r) => r.amount)), 10_000_000, 1_000_000),
      title: `Báo cáo tháng khác sổ thu chi: ${ledgerRows.length} chỗ, ${vnd(ledgerSum)}đ`,
      description:
        `Số tiền nhận, đã trả và còn lại trong báo cáo tháng phải bằng số trong sổ thu chi của tháng đó. ${ledgerRows.length} chỗ khác nhau, tổng ${vnd(ledgerSum)}đ. ` +
        `Thường báo cáo được lập khi sổ chưa chốt (còn dòng chưa ghi) hoặc sổ bị sửa sau khi lập báo cáo.`,
      recommendation: "Chốt sổ rồi lập lại báo cáo; ghi ngày lập báo cáo để biết số nào lấy tại thời điểm nào.",
      records: [],
      evidenceOverride: topByAmount(ledgerRows),
      total: ledgerRows.length,
      amount: ledgerSum,
    });
  }
  if (timing.length > 0) {
    out.drafts.push({
      rule: "report_mismatch",
      severity: "info",
      title: `Báo cáo tháng chưa cập nhật theo sổ thu chi: ${timing.length} tháng`,
      description:
        `${timing.length} báo cáo tháng khác sổ thu chi chỉ vì được lập trước khi sổ ghi hết tháng: các số nhận, trả và còn lại của báo cáo trùng khít lũy kế của sổ đến một ngày trước đó. ` +
        `Không phải sai số, nhưng báo cáo cần được lập lại sau khi chốt sổ.`,
      recommendation: "Lập lại báo cáo sau khi chốt sổ, và ghi ngày lập trên báo cáo.",
      records: [],
      evidenceOverride: timing,
      total: timing.length,
      amount: 0,
    });
  }
  if (footRows.length > 0) {
    out.drafts.push({
      rule: "report_mismatch",
      severity: severityByAmount(Math.max(...footRows.map((r) => r.amount)), 5_000_000, 100_000),
      title: `Báo cáo tháng không cộng đúng: ${footRows.length} tháng, lệch ${vnd(footSum)}đ`,
      description: `${footRows.length} dòng của báo cáo có "Số tiền còn lại" khác (tiền nhận − tiền trả − chi phí − hoàn trả). Số này là số gõ tay nên nếu một ô bị sửa mà ô còn lại không đổi thì báo cáo mâu thuẫn ngay trong chính nó.`,
      recommendation: "Thay các ô số gõ tay bằng công thức để báo cáo tự cộng.",
      records: [],
      evidenceOverride: footRows,
      total: footRows.length,
      amount: footSum,
    });
  }
  if (revRows.length > 0 || missingRevenue.length > 0) {
    const max = revRows.length > 0 ? Math.max(...revRows.map((r) => r.amount)) : 0;
    out.drafts.push({
      rule: "report_mismatch",
      severity: severityByAmount(max, 50_000_000, 5_000_000),
      title: `Doanh thu trong báo cáo tháng khác tổng doanh thu theo ngày: ${revRows.length + missingRevenue.length} tháng`,
      description:
        `Báo cáo tháng ghi doanh thu khác tổng các ngày trong tab doanh thu ở ${revRows.length} tháng (cộng các độ lệch ${vnd(revSum)}đ)` +
        (missingRevenue.length > 0 ? `; tháng ${missingRevenue.join(", ")} có tab doanh thu ngày nhưng báo cáo chưa có số doanh thu` : "") +
        `. Doanh thu báo cáo có thể được gõ tay hoặc lấy khi tab ngày chưa đủ dòng.`,
      recommendation: "Dùng công thức tổng từ tab doanh thu ngày cho báo cáo tháng.",
      records: [],
      evidenceOverride: topByAmount(revRows),
      total: revRows.length + missingRevenue.length,
      amount: revSum,
    });
  }
  if (labelQuirks.length > 0) {
    out.drafts.push({
      rule: "report_mismatch",
      severity: "low",
      title: `Nhãn cột tab tổng hợp ngày không khớp tên tab: ${labelQuirks.length} tab`,
      description: `${labelQuirks.length} tab tổng hợp ngày có tiêu đề cột ghi đợt khác với tên tab. Không sai số, nhưng dễ làm người đọc hoặc công thức tra theo nhãn lấy nhầm đợt.`,
      recommendation: "Sửa nhãn cột cho đúng đợt.",
      records: [],
      evidenceOverride: labelQuirks,
      total: labelQuirks.length,
      amount: 0,
    });
  }
  const monthsJudged = rows.size;
  out.checks.push(
    owedCk.build(owedRows.length === 0 ? "tổng trả khách khớp ở mọi tháng so được" : `${owedRows.length} chỗ lệch, cộng ${vnd(owedSum)}đ`),
    ledgerCk.build(
      (ledgerRows.length === 0 ? "nhận, đã trả, còn lại khớp sổ thu chi" : `${ledgerRows.length} chỗ khác sổ thu chi, cộng ${vnd(ledgerSum)}đ`) +
        (timing.length > 0 ? `; ${timing.length} tháng báo cáo lập trước khi sổ ghi hết tháng` : "") +
        (openingGuess.length > 0 ? `; ${openingGuess.join("; ")}` : ""),
    ),
    footCk.build(footRows.length === 0 ? "các ô còn lại gõ tay đều cộng đúng" : `${footRows.length}/${monthsJudged} tháng không cộng đúng`),
    revCk.build(revRows.length + missingRevenue.length === 0 ? "doanh thu báo cáo khớp tổng các ngày" : `${revRows.length} tháng lệch, ${missingRevenue.length} tháng chưa có số`),
  );

  const f = (get: (r: MonthlyRow) => number | undefined): Record<number, number> => {
    const o: Record<number, number> = {};
    for (const [m, { row }] of rows) {
      const v = get(row);
      if (v !== undefined) o[m] = v;
    }
    return o;
  };
  out.figures.push(
    { id: "fig.report_owed", label: "Tổng trả khách", source: "Báo cáo tháng", months: f((r) => r.owed) },
    { id: "fig.report_recv", label: "Tổng tiền nhận (gồm số dư đầu)", source: "Báo cáo tháng", months: f((r) => r.received) },
    { id: "fig.report_paid", label: "Tổng tiền đã trả", source: "Báo cáo tháng", months: f((r) => r.paid) },
    { id: "fig.report_left", label: "Số tiền còn lại", source: "Báo cáo tháng", months: f((r) => r.left) },
    { id: "fig.report_rev", label: "Doanh thu", source: "Báo cáo tháng", months: f((r) => r.revenue) },
    { id: "fig.daily_rev", label: "Doanh thu", source: "Tab doanh thu ngày (tổng các ngày)", months: Object.fromEntries(revenueByMonth) },
    { id: "fig.day_head", label: "Tổng trả khách (ô đầu tab tổng hợp ngày)", source: "Tab tổng hợp ngày", months: Object.fromEntries([...dayHead].map(([m, v]) => [m, v.value])) },
  );

  // ------------------------------------------------------------ doanh thu ngày
  const identCk = new CheckBuilder("revenue.identity", "revenue", "Doanh thu ngày = offline + online − chiết khấu (và = các hình thức thu khi tháng đó ghi đủ)");
  const identRows: EvidenceRow[] = [];
  const unitRows: EvidenceRow[] = [];
  const declRows: EvidenceRow[] = [];
  let identSum = 0;
  let identDays = 0;
  let judgedDays = 0;
  // Đẳng thức "doanh thu = chuyển khoản + tiền mặt + chi phí" chỉ áp dụng cho tháng nào cột các hình thức thu ghi đủ.
  // Điều này đo từ chính dữ liệu: tháng mà đa số ngày thỏa đẳng thức mới được dùng, tháng còn lại (doanh thu còn gồm thẻ, ví, trả góp
  // không có cột riêng) chỉ kiểm bằng offline + online, nếu không sẽ báo sai gần như mọi ngày.
  const splitApplies = new Set<number>();
  for (const t of b.revenues) {
    if (t.year !== b.year || t.rows.length === 0) continue;
    const ok = t.rows.filter((r) => Math.abs(r.revenue - (r.transfer + r.cash + r.expense)) <= SHOP.revenueTolerance).length;
    if (ok / t.rows.length >= 0.5) splitApplies.add(t.month);
  }
  const unchecked1: number[] = [];
  for (const t of b.revenues) {
    if (t.year !== b.year) continue;
    if (!splitApplies.has(t.month)) unchecked1.push(t.month);
    for (const r of t.rows) {
      judgedDays++;
      identCk.judged(t.month);
      const d1 = splitApplies.has(t.month) ? r.revenue - (r.transfer + r.cash + r.expense) : 0;
      // Chiết khấu là khoản trừ: doanh thu ghi sau chiết khấu = offline + online − chiết khấu.
      // Ở tab lẫn đơn vị, một ô chiết khấu nhỏ có thể là nghìn đồng hoặc đồng: lấy cách đọc cho độ lệch nhỏ hơn thay vì báo nhầm vì đơn vị.
      const hasSplit = r.offline !== 0 || r.online !== 0;
      let d2 = hasSplit ? r.revenue - (r.offline + r.online - r.discount) : 0;
      if (hasSplit && t.unitMixed && r.discount !== 0) {
        const alt = r.discount < 100_000 ? r.discount * 1000 : r.discount / 1000;
        const dAlt = r.revenue - (r.offline + r.online - alt);
        if (Math.abs(dAlt) < Math.abs(d2)) d2 = dAlt;
      }
      // Hai cột offline/online luôn cộng khít với doanh thu (sai số thật rất nhỏ nên dùng ngưỡng chặt).
      // Đẳng thức theo hình thức thu thì luôn có phần dư nhỏ (hình thức thu không có cột riêng) nên chỉ báo khi lệch quá 5% doanh thu ngày.
      const bad1 = Math.abs(d1) > Math.max(SHOP.revenueTolerance, r.revenue * 0.05);
      const bad2 = Math.abs(d2) > SHOP.revenueTolerance;
      if (!bad1 && !bad2) continue;
      identDays++;
      const worst = Math.max(Math.abs(d1), Math.abs(d2));
      identSum += worst;
      identRows.push(
        ev.row(t.src, r.row, {
          date: r.date,
          description: `Ngày ${dmy(r.date)}: doanh thu ${vnd(r.revenue)}${bad1 ? `; chuyển khoản ${vnd(r.transfer)} + tiền mặt ${vnd(r.cash)} + chi phí ${vnd(r.expense)} = ${vnd(r.transfer + r.cash + r.expense)}` : ""}${bad2 ? `; offline ${vnd(r.offline)} + online ${vnd(r.online)}${r.discount ? ` − chiết khấu ${vnd(r.discount)}` : ""} = ${vnd(r.offline + r.online - r.discount)}` : ""}`,
          amount: worst,
          note: `${bad1 ? `Lệch ${vnd(d1)}đ so với tổng hình thức thu. ` : ""}${bad2 ? `Lệch ${vnd(d2)}đ so với offline + online. ` : ""}${t.unitMixed ? "Tab này lẫn đơn vị nghìn đồng và đồng nên có thể chỉ là hiểu sai đơn vị." : ""}`.trim(),
        }),
      );
      identCk.issue(t.month, worst);
    }
    if (t.unitMixed) {
      unitRows.push(
        ev.row(t.src, t.headerRow + 1, {
          description: `Tab "${t.src.sheet}": các ô Chi phí/Tiền mặt vừa có số nhỏ (nghìn đồng) vừa có số lớn (đồng)`,
          amount: 0,
          note: "Không có quy ước đơn vị nên một ô gõ 50.000 có thể là 50 triệu hoặc 50 nghìn tùy cách hiểu",
        }),
      );
    }
    for (const d of t.declared.filter((x) => x.field === "revenue")) {
      const total = sum(t.rows.map((r) => r.revenue));
      identCk.judged(t.month);
      if (Math.abs(d.value - total) > tol) {
        declRows.push(
          ev.row(t.src, d.row, {
            reference: d.addr,
            description: `Tab "${t.src.sheet}" ô ${d.addr} ghi tổng doanh thu ${vnd(d.value)}, cộng các ngày được ${vnd(total)}`,
            amount: Math.abs(d.value - total),
          }),
        );
        identCk.issue(t.month, Math.abs(d.value - total));
      }
    }
  }
  if (identRows.length > 0) {
    out.drafts.push({
      rule: "revenue_mismatch",
      severity: severityByAmount(Math.max(...identRows.map((r) => r.amount)), 50_000_000, 5_000_000),
      title: `Doanh thu ngày không cộng đúng: ${identDays}/${judgedDays} ngày`,
      description:
        `Doanh thu mỗi ngày phải bằng offline + online − chiết khấu${splitApplies.size > 0 ? `, và ở tháng ${[...splitApplies].sort((x, y) => x - y).join(", ")} còn phải bằng chuyển khoản + tiền mặt + chi phí` : ""}. ` +
        `${identDays} ngày không khớp (ngưỡng ${vnd(SHOP.revenueTolerance)}đ), cộng độ lệch lớn nhất mỗi ngày ${vnd(identSum)}đ. ` +
        (unchecked1.length > 0
          ? `Tháng ${unchecked1.sort((x, y) => x - y).join(", ")} không kiểm được đẳng thức theo hình thức thu vì phần lớn ngày doanh thu lớn hơn tổng các cột đó (còn các hình thức thu khác không có cột riêng). `
          : "") +
        `Với các tháng lẫn đơn vị nghìn đồng/đồng, một phần chênh có thể chỉ do hiểu sai đơn vị.`,
      recommendation: "Xem lại từng ngày lệch: cột nào gõ sai; thống nhất đơn vị (đồng) cho các cột chi phí, tiền mặt.",
      records: [],
      evidenceOverride: topByAmount(identRows),
      total: identRows.length,
      amount: identSum,
    });
  }
  if (declRows.length > 0) {
    out.drafts.push({
      rule: "revenue_mismatch",
      severity: "medium",
      title: `Ô tổng doanh thu không bằng tổng các ngày: ${declRows.length} tab`,
      description: `${declRows.length} tab doanh thu có ô tổng khác tổng cộng các ngày.`,
      recommendation: "Thay ô tổng bằng công thức SUM.",
      records: [],
      evidenceOverride: declRows,
      total: declRows.length,
      amount: sum(declRows.map((r) => r.amount)),
    });
  }
  if (unitRows.length > 0) {
    out.drafts.push({
      rule: "revenue_mismatch",
      severity: "low",
      title: `Đơn vị tiền không thống nhất ở tab doanh thu: ${unitRows.length} tab`,
      description: `${unitRows.length} tab doanh thu có cột chi phí/tiền mặt lúc ghi bằng nghìn đồng, lúc ghi bằng đồng. Tổng cột cộng lại không có nghĩa, và mọi so sánh với sao kê phải đoán đơn vị.`,
      recommendation: "Thống nhất ghi bằng đồng đầy đủ ở mọi ô.",
      records: [],
      evidenceOverride: unitRows,
      total: unitRows.length,
      amount: 0,
    });
  }
  out.checks.push(
    identCk.build(
      identRows.length + declRows.length === 0 ? `${judgedDays} ngày doanh thu đều cộng đúng` : `${identDays}/${judgedDays} ngày không cộng đúng; ${declRows.length} ô tổng sai; ${unitRows.length} tab lẫn đơn vị`,
    ),
  );
  return out;
}
