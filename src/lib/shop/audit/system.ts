// Hệ thống quản lý ký gửi (file xuất) ↔ danh sách chuyển khoản ↔ bảng lô.
// Hệ thống chỉ có đơn tạo từ đầu năm kiểm, và "Đợt ký gửi" là tháng trả tiền, nên đợt nào đủ dữ liệu được tính từ chính file.

import type { EvidenceRow } from "@/lib/types";
import { SHOP, isBulkCode } from "../config";
import { parseBatch } from "../keys";
import type { ShopBook } from "./book";
import { CheckBuilder, type ModuleOut, type Shared, dmy, emptyOut, severityByAmount, sum, topByAmount, vnd } from "./helpers";

const monthIndex = (year: number, month: number): number => year * 12 + month;

function batchMonth(batch: string, year: number): number | null {
  const b = parseBatch(batch);
  return b && b.year === year ? b.month : null;
}

export function systemChecks(b: ShopBook, sh: Shared): ModuleOut {
  const out = emptyOut();
  const ga = b.ga;
  if (!ga) return out;
  const { ev } = sh;
  const tol = SHOP.tolerance;

  const paidCk = new CheckBuilder("system.paid_match", "system", "Hệ thống: đơn đã trả có chuyển khoản đúng số tiền");
  const statusCk = new CheckBuilder("system.unpaid_status", "system", "Hệ thống: đơn chưa trả không có chuyển khoản trước ngày xuất");
  const missingCk = new CheckBuilder("system.missing_order", "system", "Chuyển khoản đều có đơn trong hệ thống");
  const sheetCk = new CheckBuilder("system.vs_sheet", "system", "Hệ thống = bảng lô (số phải trả)");
  const totalsCk = new CheckBuilder("system.totals", "system", "Tổng quan hệ thống khớp danh sách đơn");

  // Đơn của hệ thống đã gộp theo khóa lô (mã|đợt), bỏ lô gộp "TH" và quy đơn của từng khách về lô ghép ("301+302").
  const byKey = b.gaByKey;

  // ------------------------------------------------------------ đơn đã trả ↔ chuyển khoản
  const noCk: EvidenceRow[] = [];
  const mism: EvidenceRow[] = [];
  let noCkSum = 0;
  let mismSum = 0;
  let paidJudged = 0;
  let paidExact = 0;
  for (const g of byKey.values()) {
    if (g.status !== "paid" || g.method !== "transfer") continue;
    const m = batchMonth(g.first.batch, b.year);
    const pays = b.payByKey.get(g.key) ?? [];
    paidJudged++;
    paidCk.judged(m);
    if (pays.length === 0) {
      noCkSum += g.owed;
      noCk.push(
        ev.row(ga.src, g.first.row, {
          date: g.first.paidAt,
          reference: g.key,
          role: "other",
          description: `Đơn ${g.key}: hệ thống ghi đã trả ${vnd(g.owed)} bằng chuyển khoản${g.first.paidAt ? ` ngày ${dmy(g.first.paidAt)}` : ""}, nhưng danh sách chuyển khoản không có dòng nào`,
          amount: g.owed,
        }),
      );
      paidCk.issue(m, g.owed);
      continue;
    }
    const s = sum(pays.map((p) => p.amount));
    if (Math.abs(s - g.owed) <= tol) {
      paidExact++;
      continue;
    }
    if (sh.dupKeys.has(g.key)) continue;
    const lot = b.lots.get(g.key);
    // Số đã chuyển khớp bảng lô còn hệ thống thì khác: lệch nằm ở hệ thống, báo ở phép kiểm "hệ thống = bảng lô".
    if (lot && lot.native && Math.abs(s - lot.owed) <= tol) continue;
    const d = s - g.owed;
    mismSum += Math.abs(d);
    mism.push(
      ev.row(ga.src, g.first.row, {
        date: pays.map((p) => p.date).filter((x): x is string => !!x).sort().pop(),
        reference: g.key,
        role: "other",
        description: `Đơn ${g.key}: hệ thống phải trả ${vnd(g.owed)}, danh sách CK đã chuyển ${vnd(s)} (${pays.length} dòng)${lot?.native ? `, bảng lô ghi ${vnd(lot.owed)}` : ""}`,
        amount: Math.abs(d),
        note: d > 0 ? `Chuyển nhiều hơn hệ thống ${vnd(d)}đ` : `Chuyển ít hơn hệ thống ${vnd(-d)}đ`,
      }),
    );
    paidCk.issue(m, Math.abs(d));
  }
  if (noCk.length > 0) {
    out.drafts.push({
      rule: "system_mismatch",
      severity: severityByAmount(noCkSum, 10_000_000, 1_000_000),
      title: `Hệ thống ghi đã trả nhưng không có chuyển khoản: ${noCk.length} đơn, ${vnd(noCkSum)}đ`,
      description:
        `${noCk.length} đơn được hệ thống đánh dấu "Đã trả" bằng chuyển khoản, tổng ${vnd(noCkSum)}đ, nhưng danh sách chuyển khoản không có dòng nào cho các mã này. ` +
        `Hoặc tiền đã trả mà chưa ghi vào danh sách, hoặc trạng thái "Đã trả" được đánh dấu mà chưa có tiền ra.`,
      recommendation: "Đối chiếu sao kê ngân hàng theo ngày trả ghi trong hệ thống; nếu không có lệnh chuyển thì sửa lại trạng thái và trả cho khách.",
      records: [],
      evidenceOverride: topByAmount(noCk),
      total: noCk.length,
      amount: noCkSum,
    });
  }
  if (mism.length > 0) {
    out.drafts.push({
      rule: "system_mismatch",
      severity: severityByAmount(mismSum, 10_000_000, 1_000_000),
      title: `Số tiền chuyển khác số hệ thống tính và khác bảng lô: ${mism.length} đơn, lệch ${vnd(mismSum)}đ`,
      description:
        `${mism.length} đơn đã trả có tổng tiền chuyển khác số phải trả trong hệ thống và cũng không bằng số trong bảng lô (nếu có). ` +
        `Không thể giải thích bằng chuyện bảng lô sửa số sau hệ thống, nên cần xem lại từng khoản.`,
      recommendation: "Mở từng đơn, xác định số đúng và chênh lệch đã được xử lý với khách chưa.",
      records: [],
      evidenceOverride: topByAmount(mism),
      total: mism.length,
      amount: mismSum,
    });
  }
  out.checks.push(
    paidCk.build(
      `${paidExact.toLocaleString("vi-VN")}/${paidJudged.toLocaleString("vi-VN")} đơn đã trả khớp tiền chuyển; ${noCk.length} đơn không có CK, ${mism.length} đơn lệch số tiền`,
    ),
  );

  // ------------------------------------------------------------ đơn chưa trả nhưng đã có chuyển khoản trước ngày xuất
  const stale: EvidenceRow[] = [];
  let staleSum = 0;
  let unpaidJudged = 0;
  if (ga.exportedAt) {
    for (const g of byKey.values()) {
      if (g.status !== "unpaid") continue;
      const m = batchMonth(g.first.batch, b.year);
      const pays = (b.payByKey.get(g.key) ?? []).filter((p) => p.date && p.date <= (ga.exportedAt as string));
      unpaidJudged++;
      statusCk.judged(m);
      if (pays.length === 0) continue;
      const s = sum(pays.map((p) => p.amount));
      staleSum += s;
      stale.push(
        ev.row(ga.src, g.first.row, {
          date: pays.map((p) => p.date).filter((x): x is string => !!x).sort()[0],
          reference: g.key,
          role: "other",
          description: `Đơn ${g.key}: hệ thống (xuất ${dmy(ga.exportedAt)}) vẫn ghi "Chưa trả" ${vnd(g.owed)}, nhưng đã có chuyển khoản ${vnd(s)} từ trước ngày xuất`,
          amount: s,
        }),
      );
      statusCk.issue(m, s);
    }
  }
  if (stale.length > 0) {
    out.drafts.push({
      rule: "system_mismatch",
      severity: severityByAmount(staleSum, 500_000_000, 2_000_000),
      title: `Hệ thống còn ghi "Chưa trả" dù đã chuyển khoản: ${stale.length} đơn, ${vnd(staleSum)}đ`,
      description: `${stale.length} đơn có dòng chuyển khoản dated trước hoặc đúng ngày xuất báo cáo (${dmy(ga.exportedAt)}) nhưng hệ thống vẫn để trạng thái "Chưa trả". Khách có thể nhận được tin nhắn hoặc báo cáo công nợ sai.`,
      recommendation: "Cập nhật trạng thái thanh toán trong hệ thống cho các đơn này.",
      records: [],
      evidenceOverride: topByAmount(stale),
      total: stale.length,
      amount: staleSum,
    });
  }
  out.checks.push(
    statusCk.build(
      ga.exportedAt
        ? stale.length === 0
          ? `${unpaidJudged} đơn chưa trả đều chưa có CK trước ${dmy(ga.exportedAt)}`
          : `${stale.length} đơn còn "Chưa trả" dù đã có CK`
        : "không biết ngày xuất báo cáo nên không so được",
    ),
  );

  // ------------------------------------------------------------ chuyển khoản không có đơn trong hệ thống
  // Hệ thống chỉ có đơn tạo từ ngày bắt đầu của báo cáo. Một đợt chỉ "đủ" khi đơn của đợt đó chắc chắn tạo sau ngày đó:
  // khoảng cách lớn nhất giữa tháng đợt và tháng tạo đơn được đo ngay từ dữ liệu.
  const rangeFrom = ga.overview?.rangeFrom ?? ga.orders.map((o) => o.created).filter((x): x is string => !!x).sort()[0];
  let maxGap = 0;
  for (const o of ga.orders) {
    const bi = parseBatch(o.batch);
    if (!bi || !o.created) continue;
    maxGap = Math.max(maxGap, monthIndex(bi.year, bi.month) - monthIndex(Number(o.created.slice(0, 4)), Number(o.created.slice(5, 7))));
  }
  const fromIdx = rangeFrom ? monthIndex(Number(rangeFrom.slice(0, 4)), Number(rangeFrom.slice(5, 7))) : null;
  /** Ngày tạo sớm nhất của đơn theo từng đợt. */
  const earliestCreated = new Map<string, string>();
  for (const o of ga.orders) {
    if (!o.created) continue;
    const cur = earliestCreated.get(o.batch);
    if (cur === undefined || o.created < cur) earliestCreated.set(o.batch, o.created);
  }
  const gaKeys = new Set(byKey.keys());
  const missing: EvidenceRow[] = [];
  let missingSum = 0;
  let missingJudged = 0;
  let boundaryMissing = 0;
  if (fromIdx !== null) {
    for (const [key, pays] of b.payByKey) {
      const p0 = pays[0];
      const bi = parseBatch(p0.batch);
      if (!bi || isBulkCode(p0.code)) continue;
      if (!pays.some((p) => p.date && p.date >= b.from)) continue;
      const m = batchMonth(p0.batch, b.year);
      // Đợt chỉ "đủ" khi đơn của nó chắc chắn tạo sau ngày bắt đầu của hệ thống. Đợt mà đơn tạo sớm nhất trong dữ liệu đã nằm sát ngày bắt đầu
      // (đơn dồn vào chính ranh giới) thì hệ thống bị cắt ở đó, nên không thể coi là đủ dù khoảng cách tối đa vừa khít.
      const idx = monthIndex(bi.year, bi.month);
      const earliest = earliestCreated.get(p0.batch);
      const touchesBoundary = earliest !== undefined && earliest <= (rangeFrom ?? "") .slice(0, 7) + "-31";
      if (idx - maxGap < fromIdx || touchesBoundary) {
        if (!gaKeys.has(key)) boundaryMissing++;
        continue;
      }
      missingJudged++;
      missingCk.judged(m);
      if (gaKeys.has(key)) continue;
      const amount = sum(pays.map((p) => p.amount));
      missingSum += amount;
      missing.push(
        ev.row(p0.src, p0.row, {
          date: p0.date,
          reference: key,
          description: `Chuyển khoản ${vnd(amount)} cho lô ${key} nhưng hệ thống quản lý không có đơn này`,
          amount,
          note: pays.map((p) => `${dmy(p.date)} · ${p.src.sheet} dòng ${p.row} · ${vnd(p.amount)}`).join(" ; "),
        }),
      );
      missingCk.issue(m, amount);
    }
  }
  if (missing.length > 0) {
    out.drafts.push({
      rule: "system_mismatch",
      severity: severityByAmount(missingSum, 50_000_000, 5_000_000),
      title: `Chuyển tiền cho đơn không có trong hệ thống: ${missing.length} lô, ${vnd(missingSum)}đ`,
      description:
        `${missing.length} lô trong danh sách chuyển khoản không có đơn tương ứng trong hệ thống, tổng ${vnd(missingSum)}đ. ` +
        `Chỉ xét các đợt mà đơn chắc chắn tạo sau ${dmy(rangeFrom)}: trong dữ liệu, khoảng cách lớn nhất giữa tháng đợt và tháng tạo đơn là ${maxGap} tháng, nên đợt từ ${maxGap} tháng sau ngày đó trở đi đã nằm trọn trong hệ thống ` +
        `(giả định này sai nếu có đơn ký gửi kéo dài hơn ${maxGap} tháng). Nguyên nhân có thể là mã gõ sai, đơn nhập ở nơi khác, hoặc chuyển tiền cho người không có đơn ký gửi.`,
      recommendation: "Tra từng mã: nếu đơn có thật thì bổ sung vào hệ thống; nếu không, xác định người nhận và lý do chuyển.",
      records: [],
      evidenceOverride: topByAmount(missing),
      total: missing.length,
      amount: missingSum,
      meta: { maxGapMonths: maxGap },
    });
  }
  const boundaryNote = boundaryMissing > 0 ? `; ${boundaryMissing} mã của các đợt đầu năm không có đơn nhưng đơn có thể tạo trước ${dmy(rangeFrom)} nên không kết luận` : "";
  out.checks.push(
    missingCk.build(
      (missing.length === 0
        ? `${missingJudged} mã chuyển khoản của các đợt đủ dữ liệu đều có đơn trong hệ thống`
        : `${missing.length}/${missingJudged} mã chuyển khoản không có đơn trong hệ thống`) + boundaryNote,
    ),
  );

  // ------------------------------------------------------------ hệ thống ↔ bảng lô
  const diffs: EvidenceRow[] = [];
  let diffSum = 0;
  let diffNet = 0;
  let diffHigher = 0;
  let sheetJudged = 0;
  let sheetExact = 0;
  const onlySystem: EvidenceRow[] = [];
  let onlySystemSum = 0;
  const lotTableBatches = new Set(b.lotTables.map((t) => t.mainBatch).filter((x): x is string => !!x));
  for (const g of byKey.values()) {
    const m = batchMonth(g.first.batch, b.year);
    const lot = b.lots.get(g.key);
    if (!lotTableBatches.has(g.first.batch)) continue;
    sheetJudged++;
    sheetCk.judged(m);
    if (!lot || !lot.native) {
      if (g.owed > 0) {
        onlySystemSum += g.owed;
        onlySystem.push(
          ev.row(ga.src, g.first.row, {
            reference: g.key,
            role: "other",
            description: `Đơn ${g.key}: hệ thống phải trả ${vnd(g.owed)} nhưng bảng lô đợt ${g.first.batch} không có lô này`,
            amount: g.owed,
          }),
        );
        sheetCk.issue(m, g.owed);
      }
      continue;
    }
    const d = lot.owed - g.owed;
    if (Math.abs(d) <= tol) {
      sheetExact++;
      continue;
    }
    diffSum += Math.abs(d);
    diffNet += d;
    if (d > 0) diffHigher++;
    diffs.push(
      ev.row(lot.src, lot.row, {
        reference: g.key,
        description: `Lô ${g.key}: bảng lô ghi ${vnd(lot.owed)}, hệ thống ghi ${vnd(g.owed)}`,
        amount: Math.abs(d),
        note: d > 0 ? `Bảng lô cao hơn hệ thống ${vnd(d)}đ` : `Bảng lô thấp hơn hệ thống ${vnd(-d)}đ`,
      }),
    );
    sheetCk.issue(m, Math.abs(d));
  }
  if (diffs.length > 0) {
    out.drafts.push({
      rule: "system_mismatch",
      severity: severityByAmount(diffSum, 50_000_000, 5_000_000),
      title: `Bảng lô và hệ thống khác số phải trả: ${diffs.length} lô, lệch ${vnd(diffSum)}đ`,
      description:
        `${diffs.length}/${sheetJudged} lô có số phải trả trong bảng lô khác số của hệ thống, tổng lệch tuyệt đối ${vnd(diffSum)}đ. ` +
        `Trong đó bảng lô cao hơn hệ thống ở ${diffHigher} lô và thấp hơn ở ${diffs.length - diffHigher} lô; cộng ròng bảng lô ${diffNet >= 0 ? "cao hơn" : "thấp hơn"} hệ thống ${vnd(Math.abs(diffNet))}đ. ` +
        `Chênh lệch nghiêng về một phía là dấu hiệu bảng lô bị chỉnh tay sau khi hệ thống tính; mỗi lần chỉnh cần có người duyệt và lý do ghi lại.`,
      recommendation: "Lấy các lô lệch lớn nhất, hỏi người sửa lý do và tìm chứng từ. Nếu chỉnh là hợp lệ, cập nhật hệ thống để hai nơi khớp nhau.",
      records: [],
      evidenceOverride: topByAmount(diffs),
      total: diffs.length,
      amount: diffSum,
    });
  }
  if (onlySystem.length > 0) {
    out.drafts.push({
      rule: "system_mismatch",
      severity: severityByAmount(onlySystemSum, 20_000_000, 2_000_000),
      title: `Đơn có trong hệ thống nhưng không có trong bảng lô: ${onlySystem.length} đơn, ${vnd(onlySystemSum)}đ`,
      description: `${onlySystem.length} đơn của các đợt đã có bảng lô không xuất hiện trong bảng lô, tổng ${vnd(onlySystemSum)}đ. Nếu bảng lô là căn cứ trả tiền thì các đơn này có thể bị bỏ sót.`,
      recommendation: "Bổ sung các lô vào bảng lô, hoặc ghi rõ vì sao không trả.",
      records: [],
      evidenceOverride: topByAmount(onlySystem),
      total: onlySystem.length,
      amount: onlySystemSum,
    });
  }
  out.checks.push(
    sheetCk.build(
      `${sheetExact.toLocaleString("vi-VN")}/${sheetJudged.toLocaleString("vi-VN")} lô khớp; ${diffs.length} lô khác số, ${onlySystem.length} đơn không có trong bảng lô`,
    ),
  );

  // ------------------------------------------------------------ tổng quan hệ thống ↔ danh sách đơn
  const ov = ga.overview;
  if (ov) {
    const t = ov.totals;
    const all = ga.orders;
    const checks: [string, number | undefined, number][] = [];
    const paidSum = sum(all.filter((o) => o.status === "paid").map((o) => o.owed));
    const unpaidSum2 = sum(all.filter((o) => o.status !== "paid").map((o) => o.owed));
    checks.push(["Số đơn đã trả", t.ordersPaid, all.filter((o) => o.status === "paid").length]);
    checks.push(["Tiền đã trả", t.paid, paidSum]);
    // Các tổng có gồm đơn thử nghiệm: cộng lại phần đơn thử vốn bị loại khỏi danh sách.
    checks.push(["Tổng phải trả (gồm đơn thử)", t.owed, sum(all.map((o) => o.owed)) + ga.testOwed]);
    checks.push(["Tiền chưa trả (gồm đơn thử)", t.unpaid, unpaidSum2 + ga.testOwed]);
    checks.push(["Số đơn (gồm đơn thử)", t.orders, all.length + ga.testOrders + ga.unparsed]);
    let bad = 0;
    for (const [label, declared, actual] of checks) {
      if (declared === undefined) continue;
      totalsCk.judged(null);
      if (Math.abs(declared - actual) > tol) {
        bad++;
        totalsCk.issue(null, Math.abs(declared - actual));
        out.drafts.push({
          rule: "declared_total",
          severity: "medium",
          title: `Tổng quan của hệ thống lệch danh sách đơn: ${label}`,
          description: `Tab "Tổng quan" ghi ${vnd(declared)}, tính lại từ tab đơn ký gửi được ${vnd(actual)} (lệch ${vnd(declared - actual)}). Danh sách đơn có thể đã bị sửa hoặc xóa dòng sau khi xuất.`,
          recommendation: "Xuất lại báo cáo từ hệ thống và so với bản đang dùng.",
          records: [],
          amount: Math.abs(declared - actual),
        });
      }
    }
    out.checks.push(totalsCk.build(bad === 0 ? "các tổng khai báo khớp danh sách đơn (đã tính đơn thử nghiệm)" : `${bad} tổng khai báo lệch`));
  }

  // ------------------------------------------------------------ số liệu theo tháng
  const owedByBatch: Record<number, number> = {};
  for (const o of ga.orders) {
    const m = batchMonth(o.batch, b.year);
    if (m !== null) owedByBatch[m] = (owedByBatch[m] ?? 0) + o.owed;
  }
  out.figures.push({ id: "fig.system_owed", label: "Tổng trả khách theo đợt", source: `Hệ thống (chỉ đơn tạo từ ${dmy(rangeFrom)})`, months: owedByBatch });
  return out;
}
