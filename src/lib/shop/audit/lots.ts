// Bảng lô ký gửi ↔ danh sách chuyển khoản: trả vượt/thiếu, lô chưa trả, dòng chuyển khoản trùng, chuyển khoản không có lô,
// và các ô tổng cộng của bảng lô (SUM bỏ sót hàng, ô tổng gõ tay, số lưu dạng chữ).

import type { EvidenceRow } from "@/lib/types";
import { dayDiff, parseNumber } from "@/lib/util/values";
import { SHOP, isBulkCode } from "../config";
import { parseBatch } from "../keys";
import { type PayoutEntry, type ShopBook, dueDateOf } from "./book";
import { CheckBuilder, MAX_ROWS, type ModuleOut, type Shared, dmy, emptyOut, monthOfIso, severityByAmount, sum, topByAmount, vnd } from "./helpers";

function batchMonth(batch: string | undefined, year: number): number | null {
  const b = batch ? parseBatch(batch) : null;
  return b && b.year === year ? b.month : null;
}

const lineText = (p: PayoutEntry): string => `${dmy(p.date)} · ${p.src.sheet} dòng ${p.row} · ${vnd(p.amount)}`;

export function lotChecks(b: ShopBook, sh: Shared): ModuleOut {
  const out = emptyOut();
  const { ev } = sh;
  const tol = SHOP.tolerance;

  const matchCk = new CheckBuilder("lots.paid_match", "lots", "Lô: tiền đã chuyển = số phải trả");
  const unpaidCk = new CheckBuilder("lots.unpaid", "lots", "Lô đến hạn đều có chuyển khoản");
  const dupCk = new CheckBuilder("lots.payout_dup", "lots", "Dòng chuyển khoản không bị ghi trùng");
  const orphanCk = new CheckBuilder("lots.payout_orphan", "lots", "Chuyển khoản đều có lô tương ứng");
  const declCk = new CheckBuilder("lots.declared", "lots", "Ô tổng của bảng lô đúng");

  const lotTableBatches = new Set(b.lotTables.map((t) => t.mainBatch).filter((x): x is string => !!x));
  for (const t of b.lotTables) {
    const m = batchMonth(t.mainBatch, b.year);
    if (m === null) continue;
    matchCk.judged(m, 0);
    unpaidCk.judged(m, 0);
    declCk.judged(m, 0);
  }

  // ------------------------------------------------------------ lô ↔ chuyển khoản
  const over: EvidenceRow[] = [];
  const under: EvidenceRow[] = [];
  const unpaid: (EvidenceRow & { days: number })[] = [];
  const oldUnpaid: EvidenceRow[] = [];
  let exact = 0;
  let sysAgrees = 0;
  let judged = 0;
  let notDue = 0;
  let notDueAmount = 0;
  let overSum = 0;
  let underSum = 0;
  let unpaidSum = 0;
  let oldSum = 0;
  let maxOverdue = 0;

  for (const lot of b.lots.values()) {
    const bi = parseBatch(lot.batch);
    if (!bi) continue;
    const pays = b.payByKey.get(lot.key) ?? [];
    const paid = sum(pays.map((p) => p.amount));
    const in2026 = bi.year === b.year;
    const paidIn2026 = pays.some((p) => p.date && p.date >= b.from);
    const m = in2026 ? bi.month : null;

    if (paid > 0) {
      if (!in2026 && !paidIn2026) continue;
      judged++;
      matchCk.judged(m);
      const d = paid - lot.owed;
      if (Math.abs(d) <= tol) {
        exact++;
        continue;
      }
      // Hệ thống quản lý là nguồn độc lập thứ ba: nếu số đã chuyển khớp số của hệ thống thì chỗ sai là bảng lô, không phải tiền chuyển dư.
      const sys = b.gaByKey.get(lot.key);
      const sysNote =
        sys && Math.abs(paid - sys.owed) <= tol
          ? ` Số đã chuyển KHỚP số phải trả của hệ thống (${vnd(sys.owed)}đ), nên nhiều khả năng bảng lô ghi sai/thiếu chứ không phải trả dư.`
          : sys
            ? ` Hệ thống ghi phải trả ${vnd(sys.owed)}đ.`
            : "";
      const row = ev.row(lot.src, lot.row, {
        date: pays.map((p) => p.date).filter((x): x is string => !!x).sort().pop(),
        reference: lot.key,
        description: `Lô ${lot.key}: bảng lô ghi phải trả ${vnd(lot.owed)}, danh sách CK đã chuyển ${vnd(paid)} (${pays.length} dòng)`,
        amount: Math.abs(d),
        note: `${pays.map(lineText).join(" ; ")}.${sysNote}`,
      });
      if (sys && Math.abs(paid - sys.owed) <= tol) sysAgrees++;
      if (d > 0) {
        over.push(row);
        overSum += d;
      } else {
        under.push(row);
        underSum += -d;
      }
      matchCk.issue(m, Math.abs(d));
      continue;
    }

    if (lot.owed <= 0) continue;
    if (in2026) {
      const due = dueDateOf(lot.batch);
      if (due && b.asOf <= due) {
        notDue++;
        notDueAmount += lot.owed;
        continue;
      }
      const days = due ? dayDiff(b.asOf, due) : 0;
      maxOverdue = Math.max(maxOverdue, days);
      unpaidSum += lot.owed;
      unpaid.push({
        ...ev.row(lot.src, lot.row, {
          date: due ?? undefined,
          reference: lot.key,
          description: `Lô ${lot.key}: phải trả ${vnd(lot.owed)}, chưa có dòng chuyển khoản nào`,
          amount: lot.owed,
          note: `Hạn trả ${dmy(due ?? undefined)}, quá hạn ${days} ngày${lot.ckDate ? `; bảng lô có ghi ngày CK ${dmy(lot.ckDate)}` : ""}`,
        }),
        days,
      });
      unpaidCk.issue(m, lot.owed);
    } else if (bi.year < b.year) {
      oldSum += lot.owed;
      oldUnpaid.push(
        ev.row(lot.src, lot.row, {
          reference: lot.key,
          description: `Lô ${lot.key} (đợt ${String(bi.month).padStart(2, "0")}/${bi.year}): còn phải trả ${vnd(lot.owed)} trong bảng đợt ${lot.tableBatch ?? "?"}`,
          amount: lot.owed,
          note: "Không thấy dòng chuyển khoản nào cho lô này ở bất kỳ tab nào",
        }),
      );
    }
  }
  if (over.length > 0) {
    out.drafts.push({
      rule: "lot_amount_mismatch",
      severity: severityByAmount(overSum, 1_000_000, 100_000),
      title: `Trả vượt số phải trả: ${over.length} lô, thừa ${vnd(overSum)}đ`,
      description:
        `Tổng tiền trong danh sách chuyển khoản của ${over.length} lô lớn hơn số phải trả ghi ở bảng lô, tổng thừa ${vnd(overSum)}đ. ` +
        `Nguyên nhân thường gặp: lô được trả hai lần (cùng một khoản ghi ở hai ngày hoặc hai tab), hoặc trả bù một lần rồi trả lại đủ.` +
        (sysAgrees > 0 ? ` Ở ${sysAgrees} lô, số đã chuyển lại khớp số phải trả của hệ thống, nghĩa là bảng lô ghi thiếu chứ không phải trả dư (xem ghi chú từng lô).` : ""),
      recommendation: "Mở từng dòng chuyển khoản trong ghi chú, đối chiếu sao kê ngân hàng xem tiền đã thực sự ra hai lần chưa. Nếu đã ra, yêu cầu khách hoàn lại hoặc trừ vào kỳ sau.",
      records: [],
      evidenceOverride: topByAmount(over),
      total: over.length,
      amount: overSum,
    });
  }
  if (under.length > 0) {
    out.drafts.push({
      rule: "lot_amount_mismatch",
      severity: severityByAmount(underSum, 5_000_000, 500_000),
      title: `Trả thiếu so với số phải trả: ${under.length} lô, thiếu ${vnd(underSum)}đ`,
      description: `Tổng tiền đã chuyển của ${under.length} lô nhỏ hơn số phải trả, thiếu ${vnd(underSum)}đ. Khách chưa nhận đủ hoặc còn một lần chuyển chưa được ghi vào danh sách.`,
      recommendation: "Xác nhận với khách đã nhận đủ chưa; nếu chưa thì bổ sung khoản còn thiếu.",
      records: [],
      evidenceOverride: topByAmount(under),
      total: under.length,
      amount: underSum,
    });
  }
  if (unpaid.length > 0) {
    // Mức độ theo cả tiền lẫn tuổi nợ: nợ lâu mà nhỏ chưa đáng Cao, nợ lớn dù mới quá hạn thì có.
    const over90 = sum(unpaid.filter((u) => u.days > 90).map((u) => u.amount));
    const sev = over90 >= 5_000_000 || unpaidSum >= 50_000_000 ? "high" : maxOverdue > 30 || unpaidSum >= 10_000_000 ? "medium" : "low";
    unpaid.sort((a, c) => c.days - a.days || c.amount - a.amount);
    out.drafts.push({
      rule: "lot_unpaid",
      severity: sev,
      title: `Lô đã quá hạn chưa thấy chuyển khoản: ${unpaid.length} lô, ${vnd(unpaidSum)}đ`,
      description:
        `${unpaid.length} lô của các đợt năm ${b.year} đã qua hạn trả (ngày ${SHOP.dueDay} của tháng đợt, tính đến ${dmy(b.asOf)}) nhưng danh sách chuyển khoản không có dòng nào cho các lô này, ` +
        `tổng ${vnd(unpaidSum)}đ. Quá hạn lâu nhất ${maxOverdue} ngày. Có thể là còn nợ khách, hoặc đã trả nhưng chưa ghi vào danh sách.`,
      recommendation: "Kiểm tra sao kê xem đã chuyển chưa. Nếu chưa, lên lịch trả; nếu đã chuyển, bổ sung dòng vào danh sách chuyển khoản để sổ khớp nhau.",
      records: [],
      evidenceOverride: unpaid.slice(0, MAX_ROWS),
      total: unpaid.length,
      amount: unpaidSum,
      meta: { notDueLots: notDue, notDueAmount, asOf: b.asOf },
    });
  }
  if (oldUnpaid.length > 0) {
    out.drafts.push({
      rule: "lot_unpaid",
      severity: oldSum >= 10_000_000 ? "medium" : "low",
      title: `Lô từ các năm trước còn treo trong bảng: ${oldUnpaid.length} lô, ${vnd(oldSum)}đ`,
      description:
        `${oldUnpaid.length} lô thuộc đợt trước ${b.year} vẫn còn số phải trả trong các bảng lô ${b.year}, và không có dòng chuyển khoản nào ở bất kỳ tab nào. ` +
        `Đây là nợ khách ký gửi tồn đọng (hoặc lô đã xử lý bằng cách khác nhưng chưa xóa khỏi bảng), tổng ${vnd(oldSum)}đ.`,
      recommendation: "Liên hệ khách để trả, hoặc ghi nhận xử lý (khách bỏ, bù trừ) và đánh dấu trong bảng.",
      records: [],
      evidenceOverride: topByAmount(oldUnpaid),
      total: oldUnpaid.length,
      amount: oldSum,
    });
  }

  out.checks.push(
    matchCk.build(`${exact.toLocaleString("vi-VN")}/${judged.toLocaleString("vi-VN")} lô khớp tuyệt đối; ${over.length} trả vượt, ${under.length} trả thiếu`),
    unpaidCk.build(unpaid.length === 0 ? `không có lô quá hạn chưa trả (${notDue} lô chưa đến hạn)` : `${unpaid.length} lô quá hạn chưa trả, ${vnd(unpaidSum)}đ; ${notDue} lô chưa đến hạn`),
  );

  // ------------------------------------------------------------ dòng chuyển khoản trùng
  const groups = new Map<string, PayoutEntry[]>();
  for (const p of b.payouts) {
    if (isBulkCode(p.code) || !p.date) continue;
    const k = `${p.key}#${p.amount}`;
    const g = groups.get(k) ?? [];
    g.push(p);
    groups.set(k, g);
  }
  const dups: EvidenceRow[] = [];
  let dupExtra = 0;
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const dates = g.map((p) => p.date as string).sort();
    if (dates[dates.length - 1] < b.from) continue;
    const span = dayDiff(dates[dates.length - 1], dates[0]);
    if (span > 10) continue; // hai lần chuyển cùng số tiền cách nhau xa có thể là hai đợt trả hợp lệ
    const extra = (g.length - 1) * g[0].amount;
    dupExtra += extra;
    sh.dupKeys.add(g[0].key);
    const m = monthOfIso(dates[dates.length - 1], b.year);
    dupCk.judged(m);
    dupCk.issue(m, extra);
    dups.push(
      ev.row(g[0].src, g[0].row, {
        date: dates[dates.length - 1],
        reference: g[0].key,
        description: `Lô ${g[0].key}: ${g.length} dòng cùng số tiền ${vnd(g[0].amount)}${span === 0 ? " cùng ngày" : `, cách nhau ${span} ngày`}`,
        amount: extra,
        note: g.map(lineText).join(" ; "),
      }),
    );
  }
  for (const p of b.payouts) if (p.date && p.date >= b.from) dupCk.judged(monthOfIso(p.date, b.year), 0);
  if (dups.length > 0) {
    out.drafts.push({
      rule: "payout_duplicate",
      severity: severityByAmount(dupExtra, 5_000_000, 500_000),
      title: `Dòng chuyển khoản bị ghi trùng: ${dups.length} lô, ${vnd(dupExtra)}đ`,
      description:
        `${dups.length} lô có từ hai dòng chuyển khoản trở lên cùng số tiền trong vòng 10 ngày, phần dôi ra là ${vnd(dupExtra)}đ. ` +
        `Nếu là cùng một lần chuyển bị chép sang hai tab (ví dụ tab tháng trước và tab tháng sau) thì tổng "đã trả" bị thổi phồng; nếu tiền thật sự ra hai lần thì shop đã trả thừa.`,
      recommendation: "Đối chiếu sao kê đúng ngày chuyển: nếu chỉ có một lệnh chuyển, xóa dòng ghi trùng; nếu có hai, đòi lại tiền thừa.",
      records: [],
      evidenceOverride: topByAmount(dups),
      total: dups.length,
      amount: dupExtra,
    });
  }
  out.checks.push(dupCk.build(dups.length === 0 ? "không có dòng chuyển khoản ghi trùng" : `${dups.length} lô bị ghi trùng, dôi ra ${vnd(dupExtra)}đ`));

  // ------------------------------------------------------------ chuyển khoản không có lô
  const orphans: EvidenceRow[] = [];
  let orphanSum = 0;
  let orphanJudged = 0;
  const seenOrphan = new Set<string>();
  for (const [key, pays] of b.payByKey) {
    if (pays.length === 0) continue;
    const p0 = pays[0];
    if (isBulkCode(p0.code) || !lotTableBatches.has(p0.batch)) continue;
    if (!pays.some((p) => p.date && p.date >= b.from)) continue;
    orphanJudged++;
    const m = monthOfIso(pays.map((p) => p.date).filter((x): x is string => !!x).sort().pop(), b.year);
    orphanCk.judged(m);
    if (b.lots.has(key) || seenOrphan.has(key)) continue;
    seenOrphan.add(key);
    const amount = sum(pays.map((p) => p.amount));
    orphanCk.issue(m, amount);
    orphanSum += amount;
    orphans.push(
      ev.row(p0.src, p0.row, {
        date: p0.date,
        reference: key,
        description: `Chuyển khoản cho lô ${key} nhưng bảng lô đợt ${p0.batch} không có mã này`,
        amount,
        note: pays.map(lineText).join(" ; "),
      }),
    );
  }
  if (orphans.length > 0) {
    out.drafts.push({
      rule: "payout_orphan",
      severity: severityByAmount(orphanSum, 5_000_000, 500_000),
      title: `Chuyển khoản không có lô tương ứng: ${orphans.length} lô, ${vnd(orphanSum)}đ`,
      description: `${orphans.length} mã lô có tiền chuyển đi nhưng bảng lô của đợt đó không có mã này, tổng ${vnd(orphanSum)}đ. Có thể gõ sai mã/đợt, hoặc chuyển tiền cho khoản không có chứng từ phải trả.`,
      recommendation: "Xác định khoản chuyển này trả cho ai, tra mã đúng, và bổ sung lô vào bảng nếu hợp lệ.",
      records: [],
      evidenceOverride: topByAmount(orphans),
      total: orphans.length,
      amount: orphanSum,
    });
  }
  out.checks.push(orphanCk.build(orphans.length === 0 ? `${orphanJudged.toLocaleString("vi-VN")} mã lô có chuyển khoản đều có trong bảng lô` : `${orphans.length}/${orphanJudged} mã chuyển khoản không có lô`));

  // ------------------------------------------------------------ ô tổng của bảng lô
  const declIssues: EvidenceRow[] = [];
  const textIssues: EvidenceRow[] = [];
  let declSum = 0;
  let textOwedSum = 0;
  let textQtyCells = 0;
  for (const t of b.lotTables) {
    const m = batchMonth(t.mainBatch, b.year);
    if (m === null) continue;
    const native = t.rows.filter((r) => r.batch === t.mainBatch);
    const nativeSum = sum(native.map((r) => r.owed));
    const allSum = sum(t.rows.map((r) => r.owed));
    const unit = SHOP.unit.lots;
    const firstLotRow = t.rows.length > 0 ? Math.min(...t.rows.map((r) => r.row)) : Infinity;

    // Nhiều ô tổng có thể cùng sai vì một nguyên nhân (ví dụ cùng bỏ sót một khối hàng): tính tiền lệch một lần cho mỗi bảng.
    let tableMissing = 0;
    for (const d of t.declared.filter((x) => x.field === "owed")) {
      const value = d.value * unit;
      if (d.range) {
        const range = d.range;
        // Ô tổng nào cũng có một tập lô mà nó định cộng: nếu vùng cộng chạy tới hết bảng thì đó là tổng cả bảng
        // (gồm lô còn treo), ngược lại là tổng các lô của đợt.
        const lastRow = Math.max(...t.rows.map((r) => r.row));
        const intendedAll = range.to >= lastRow;
        const population = intendedAll ? t.rows : native;
        const outside = population.filter((r) => r.row < range.from || r.row > range.to);
        const missing = sum(outside.map((r) => r.owed));
        if (outside.length > 0 && missing > tol) {
          const rowsText = `${Math.min(...outside.map((r) => r.row))}–${Math.max(...outside.map((r) => r.row))}`;
          const correct = intendedAll ? allSum : nativeSum;
          tableMissing = Math.max(tableMissing, missing);
          declIssues.push(
            ev.row(t.src, d.row, {
              reference: d.addr,
              description: `Tab "${t.src.sheet}" ô ${d.addr} = ${vnd(value)} (công thức ${d.formula}) chỉ cộng hàng ${range.from}–${range.to}`,
              amount: missing,
              note: `Bỏ sót ${outside.length} lô ở hàng ${rowsText}, tổng ${vnd(missing)}đ. Tổng đúng ${intendedAll ? "của cả bảng" : `của đợt ${t.mainBatch}`} là ${vnd(correct)}đ (chênh ${vnd(correct - value)}đ)`,
            }),
          );
        }
      } else if (d.row < firstLotRow) {
        // Ô tổng gõ tay ở đầu bảng: so với tập lô gần nhất (các lô của đợt, hoặc cả lô còn treo).
        const dNative = value - nativeSum;
        const dAll = value - allSum;
        const useAll = Math.abs(dAll) < Math.abs(dNative);
        const diff = useAll ? dAll : dNative;
        if (Math.abs(diff) > tol) {
          declSum += Math.abs(diff);
          declCk.issue(m, Math.abs(diff));
          declIssues.push(
            ev.row(t.src, d.row, {
              reference: d.addr,
              description: `Tab "${t.src.sheet}" ô ${d.addr} = ${vnd(value)} là số gõ tay (không có công thức)`,
              amount: Math.abs(diff),
              note: `Tính lại ${useAll ? "cả lô còn treo" : `các lô của đợt ${t.mainBatch}`} được ${vnd(useAll ? allSum : nativeSum)}đ (chênh ${vnd(diff)}đ)`,
            }),
          );
        }
      }
    }
    if (tableMissing > 0) {
      declSum += tableMissing;
      declCk.issue(m, tableMissing);
    }

    const owedText = t.textNumbers.filter((x) => x.field === "owed");
    if (owedText.length > 0) {
      const amount = sum(owedText.map((x) => (parseNumber(x.text) ?? 0) * unit));
      textOwedSum += amount;
      declCk.issue(m, amount);
      textIssues.push(
        ev.row(t.src, t.headerRow + 1, {
          description: `Tab "${t.src.sheet}": ${owedText.length} ô "Tổng trả khách" lưu dạng chữ (${owedText.slice(0, 6).map((x) => x.addr).join(", ")}${owedText.length > 6 ? "…" : ""})`,
          amount,
          note: "Hàm SUM bỏ qua ô lưu dạng chữ nên các ô tổng thiếu phần tiền này",
        }),
      );
    }
    textQtyCells += t.textNumbers.filter((x) => x.field !== "owed").length;
  }
  if (declIssues.length > 0) {
    out.drafts.push({
      rule: "declared_total",
      severity: severityByAmount(declSum, 10_000_000, 500_000),
      title: `Ô tổng của bảng lô không đúng: ${declIssues.length} ô`,
      description:
        `Ô "Tổng trả khách" ở đầu bảng lô là con số được chép sang báo cáo tháng. ${declIssues.length} ô trong số đó không bằng tổng các lô tính lại: ` +
        `công thức SUM bỏ sót hàng (khi chèn thêm một khối tiêu đề vào giữa bảng) hoặc số gõ tay đã cũ.`,
      recommendation: "Sửa công thức SUM bao hết các lô của đợt (không chia thành hai khối), thay số gõ tay bằng công thức, rồi cập nhật lại báo cáo tháng.",
      records: [],
      evidenceOverride: topByAmount(declIssues),
      total: declIssues.length,
      amount: declSum,
    });
  }
  if (textIssues.length > 0) {
    out.drafts.push({
      rule: "declared_total",
      severity: severityByAmount(textOwedSum, 5_000_000, 100_000),
      title: `Ô tiền lưu dạng chữ nên không được cộng: ${textIssues.length} bảng`,
      description: `Có ô "Tổng trả khách" được nhập dưới dạng chữ (thường do dán từ nơi khác hoặc gõ dấu phẩy thừa). Các ô này không được hàm SUM cộng vào, tổng cộng ${vnd(textOwedSum)}đ.`,
      recommendation: "Chuyển các ô này về dạng số.",
      records: [],
      evidenceOverride: topByAmount(textIssues),
      total: textIssues.length,
      amount: textOwedSum,
    });
  }
  if (textQtyCells > 0) {
    out.drafts.push({
      rule: "declared_total",
      severity: "low",
      title: `Số lượng đã bán lưu dạng chữ: ${textQtyCells} ô`,
      description: `${textQtyCells} ô số lượng (đã bán) trong các bảng lô được lưu dạng chữ, nên tổng số lượng và số tồn ở đầu bảng bị thiếu. Không ảnh hưởng đến tiền phải trả nhưng làm sai số tồn khi kiểm hàng.`,
      recommendation: "Chuyển các ô này về dạng số trước khi kiểm kê hàng.",
      records: [],
      amount: 0,
    });
  }
  out.checks.push(
    declCk.build(
      declIssues.length + textIssues.length === 0
        ? "ô tổng khớp tổng các lô"
        : `${declIssues.length} ô tổng sai, ${textIssues.length} bảng có ô tiền lưu dạng chữ`,
    ),
  );

  // ------------------------------------------------------------ số liệu theo tháng
  const owedByMonth: Record<number, number> = {};
  for (const t of b.lotTables) {
    const m = batchMonth(t.mainBatch, b.year);
    if (m !== null) owedByMonth[m] = sum(t.rows.filter((r) => r.batch === t.mainBatch).map((r) => r.owed));
  }
  const paidByMonth: Record<number, number> = {};
  for (const p of b.payouts) {
    const m = monthOfIso(p.date, b.year);
    if (m !== null) paidByMonth[m] = (paidByMonth[m] ?? 0) + p.amount;
  }
  out.figures.push(
    { id: "fig.lots_owed", label: "Tổng trả khách theo đợt", source: "Bảng lô (Sheet)", months: owedByMonth },
    { id: "fig.payouts", label: "Đã chuyển khoản trả khách", source: "Danh sách CK (theo ngày chuyển)", months: paidByMonth },
  );
  if (b.lotTables.length > 0) {
    const have = new Set(Object.keys(owedByMonth).map(Number));
    const missing: number[] = [];
    const last = Number(b.asOf.slice(5, 7));
    for (let m = 1; m <= last; m++) if (!have.has(m)) missing.push(m);
    if (missing.length > 0) {
      out.coverage.push({
        kind: "table",
        level: "warn",
        label: `Chưa có bảng lô ký gửi của tháng ${missing.join(", ")}`,
        detail: "Các đợt này không đối chiếu được số phải trả với tiền đã chuyển; chỉ kiểm được chuyển khoản ghi trùng và so với hệ thống.",
      });
    }
  }
  return out;
}
