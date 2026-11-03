// Luật trùng lặp: dòng giống hệt, số chứng từ/hóa đơn dùng lặp, nghi thanh toán trùng.

import type { AuditRecord, Severity, SourceRole } from "@/lib/types";
import { fmtMoney } from "@/lib/util/stats";
import { normRef, normText, partyKey } from "@/lib/util/text";
import { dayDiff } from "@/lib/util/values";
import {
  type FindingDraft,
  type RuleContext,
  maxThreshold,
  roleLabelShort,
  sideOf,
  sortByAmountDesc,
} from "../shared";

const GENERIC_REFS = new Set(["KHONG", "NONE", "NULL", "NIL", "NA", "TIENMAT", "CASH", "NOREF"]);

function usableRef(ref: string | undefined): string | null {
  if (!ref) return null;
  const n = normRef(ref);
  if (n.length < 3 || /^0+$/.test(n) || GENERIC_REFS.has(n)) return null;
  return n;
}

function exactSignature(r: AuditRecord): string {
  return [
    r.role,
    sideOf(r),
    r.amount.toFixed(2),
    r.date ?? "",
    normRef(r.reference),
    normRef(r.series),
    normText(r.description ?? ""),
    partyKey(r.counterparty) ?? "",
  ].join("|");
}

function groupBy<T>(items: T[], keyOf: (t: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = keyOf(it);
    if (k === null) continue;
    const g = m.get(k);
    if (g) g.push(it);
    else m.set(k, [it]);
  }
  return m;
}

interface GroupedBuild {
  records: AuditRecord[];
  notes: Map<string, string>;
  exposure: number;
}

function buildGroups(groups: AuditRecord[][], noteOf?: (g: AuditRecord[]) => string): GroupedBuild {
  const sorted = [...groups].sort((a, b) => b[0].amount * (b.length - 1) - a[0].amount * (a.length - 1));
  const records: AuditRecord[] = [];
  const notes = new Map<string, string>();
  let exposure = 0;
  sorted.forEach((g, gi) => {
    exposure += g[0].amount * (g.length - 1);
    const extra = noteOf ? ` · ${noteOf(g)}` : "";
    g.forEach((r, i) => {
      records.push(r);
      notes.set(r.id, `Nhóm ${gi + 1} · lần ${i + 1}/${g.length}${extra}`);
    });
  });
  return { records, notes, exposure };
}

const countRecords = (groups: AuditRecord[][]) => groups.reduce((s, g) => s + g.length, 0);

export function duplicateRules(ctx: RuleContext): FindingDraft[] {
  const drafts: FindingDraft[] = [];
  const claimed = new Set<string>();
  const bigThreshold = maxThreshold(ctx.settings);

  // ---- Tier A: dòng giống hệt
  const exact = groupBy(
    ctx.positive.filter((r) => r.reference || r.description),
    exactSignature,
  );
  const sameFileWithRef: AuditRecord[][] = [];
  const sameFileNoRef: AuditRecord[][] = [];
  const crossFile: AuditRecord[][] = [];
  for (const g of exact.values()) {
    if (g.length < 2) continue;
    const perFile = new Map<string, number>();
    for (const r of g) perFile.set(r.fileId, (perFile.get(r.fileId) ?? 0) + 1);
    const maxPer = Math.max(...perFile.values());
    for (const r of g) claimed.add(r.id);
    if (maxPer >= 2) (g.some((r) => r.reference) ? sameFileWithRef : sameFileNoRef).push(g);
    else crossFile.push(g);
  }

  const pushA = (groups: AuditRecord[][], severity: Severity, intro: string, recommendation: string) => {
    if (groups.length === 0) return;
    const b = buildGroups(groups);
    drafts.push({
      rule: "duplicate_row",
      severity,
      title: "Dòng giao dịch trùng lặp",
      description: `${intro} Có ${groups.length.toLocaleString("vi-VN")} nhóm (${countRecords(groups).toLocaleString("vi-VN")} dòng); phần số tiền bị lặp ước tính ${fmtMoney(b.exposure)}.`,
      recommendation,
      records: b.records,
      notes: b.notes,
      amount: b.exposure,
    });
  };
  pushA(
    sameFileWithRef,
    "high",
    "Các dòng giống hệt nhau về ngày, số tiền, số chứng từ và diễn giải trong cùng một file.",
    "Đối chiếu chứng từ gốc và sổ phụ ngân hàng để biết đây là ghi sổ hai lần hay hai giao dịch có thật. Xem người nhập và người duyệt các dòng này.",
  );
  pushA(
    sameFileNoRef,
    "medium",
    "Các dòng giống hệt nhau về ngày, số tiền và diễn giải, nhưng không có số chứng từ nên chưa thể kết luận.",
    "Hỏi bộ phận kế toán về các giao dịch lặp này; kiểm tra có chứng từ riêng cho từng lần hay không.",
  );
  pushA(
    crossFile,
    "low",
    "Các dòng giống hệt nhau xuất hiện ở nhiều file cùng loại. Thường do hai file có kỳ chồng lấn hoặc một dữ liệu bị nạp hai lần.",
    "Kiểm tra kỳ của các file; loại bớt file trùng nếu là cùng một dữ liệu để tránh tính hai lần.",
  );

  // ---- Tier B: số chứng từ / hóa đơn dùng lặp
  const invoiceGroups: AuditRecord[][] = [];
  const invoiceCandidates = groupBy(
    ctx.positive.filter((r) => r.role === "invoice" && !claimed.has(r.id)),
    (r) => {
      const ref = usableRef(r.reference);
      return ref ? `${normRef(r.series)}|${ref}` : null;
    },
  );
  const invoiceDifferentAmount: AuditRecord[][] = [];
  for (const g of invoiceCandidates.values()) {
    if (g.length < 2) continue;
    const sameAmount = g.every((r) => Math.abs(r.amount - g[0].amount) < 0.005);
    const sameParty = g.every((r) => (partyKey(r.counterparty) ?? "") === (partyKey(g[0].counterparty) ?? ""));
    const sameDate = g.every((r) => (r.date ?? "") === (g[0].date ?? ""));
    // Cùng số, cùng bên, cùng ngày, khác số tiền: nhiều khả năng là các dòng hàng của một hóa đơn.
    if (!sameAmount && sameParty && sameDate) continue;
    for (const r of g) claimed.add(r.id);
    (sameAmount ? invoiceGroups : invoiceDifferentAmount).push(g);
  }
  if (invoiceGroups.length > 0) {
    const b = buildGroups(invoiceGroups, (g) => (new Set(g.map((r) => r.date ?? "")).size > 1 ? "khác ngày" : "cùng ngày"));
    drafts.push({
      rule: "duplicate_reference",
      severity: "high",
      title: "Số hóa đơn bị dùng lặp",
      description: `Cùng ký hiệu + số hóa đơn và cùng số tiền xuất hiện nhiều lần trong danh sách hóa đơn: ${invoiceGroups.length.toLocaleString("vi-VN")} nhóm, phần tiền bị lặp ước tính ${fmtMoney(b.exposure)}. Đây là dấu hiệu điển hình của hóa đơn bị kê khai hai lần hoặc bị nhân bản.`,
      recommendation: "Tra cứu hóa đơn trên cổng tra cứu của cơ quan thuế/nhà cung cấp hóa đơn điện tử, kiểm tra từng hóa đơn chỉ được hạch toán và thanh toán một lần.",
      records: b.records,
      notes: b.notes,
      amount: b.exposure,
    });
  }
  if (invoiceDifferentAmount.length > 0) {
    const b = buildGroups(invoiceDifferentAmount, (g) => `số tiền: ${g.map((r) => fmtMoney(r.amount)).join(" / ")}`);
    drafts.push({
      rule: "duplicate_reference",
      severity: "high",
      title: "Cùng số hóa đơn nhưng thông tin mâu thuẫn",
      description: `${invoiceDifferentAmount.length.toLocaleString("vi-VN")} số hóa đơn xuất hiện nhiều lần với số tiền, ngày hoặc đối tác khác nhau. Một hóa đơn thật chỉ có một bộ thông tin.`,
      recommendation: "Đối chiếu bản gốc hóa đơn với dữ liệu kê khai; làm rõ dòng nào đúng và vì sao có dòng còn lại.",
      records: b.records,
      notes: b.notes,
      amount: sortByAmountDesc(b.records)[0]?.amount ?? 0,
    });
  }

  const otherRefGroups = new Map<SourceRole, AuditRecord[][]>();
  const otherRef = groupBy(
    ctx.positive.filter((r) => r.role !== "invoice" && !claimed.has(r.id)),
    (r) => {
      const ref = usableRef(r.reference);
      return ref ? `${r.role}|${ref}|${sideOf(r)}|${r.amount.toFixed(2)}` : null;
    },
  );
  for (const g of otherRef.values()) {
    if (g.length < 2) continue;
    for (const r of g) claimed.add(r.id);
    const list = otherRefGroups.get(g[0].role) ?? [];
    list.push(g);
    otherRefGroups.set(g[0].role, list);
  }
  for (const [role, groups] of otherRefGroups) {
    const b = buildGroups(groups);
    drafts.push({
      rule: "duplicate_reference",
      severity: "medium",
      title: `Số chứng từ trùng và số tiền trùng (${roleLabelShort(role)})`,
      description: `${groups.length.toLocaleString("vi-VN")} nhóm dòng có cùng số chứng từ/tham chiếu, cùng phía Nợ/Có và cùng số tiền nhưng khác ngày hoặc diễn giải. Phần tiền bị lặp ước tính ${fmtMoney(b.exposure)}.`,
      recommendation: "Xem lại từng cặp: nếu là một chứng từ thì có thể bị ghi hai lần; nếu là hai chứng từ thì số chứng từ bị cấp trùng.",
      records: b.records,
      notes: b.notes,
      amount: b.exposure,
    });
  }

  // ---- Tier C: nghi thanh toán trùng (cùng đối tác, cùng số tiền, gần ngày, khác chứng từ)
  const windowDays = ctx.settings.duplicateWindowDays;
  const perRole = new Map<SourceRole, AuditRecord[][]>();
  const candidates = groupBy(
    ctx.positive.filter((r) => !claimed.has(r.id) && r.date && r.amount >= ctx.settings.minAmount && partyKey(r.counterparty)),
    (r) => `${r.role}|${partyKey(r.counterparty)}|${sideOf(r)}|${r.amount.toFixed(2)}`,
  );
  for (const g of candidates.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => (a.date as string).localeCompare(b.date as string));
    let cluster: AuditRecord[] = [g[0]];
    const flush = () => {
      if (cluster.length >= 2) {
        const refs = new Set(cluster.map((r) => normRef(r.reference)).filter(Boolean));
        // Cùng một số chứng từ đã được Tier B xử lý; ở đây chỉ lấy trường hợp khác số.
        if (refs.size !== 1 || cluster.some((r) => !r.reference)) {
          const list = perRole.get(cluster[0].role) ?? [];
          list.push(cluster);
          perRole.set(cluster[0].role, list);
        }
      }
    };
    for (let i = 1; i < g.length; i++) {
      const last = cluster[cluster.length - 1];
      if (dayDiff(g[i].date as string, last.date as string) <= windowDays) cluster.push(g[i]);
      else {
        flush();
        cluster = [g[i]];
      }
    }
    flush();
  }
  for (const [role, clusters] of perRole) {
    const b = buildGroups(clusters, (g) => `${g[0].counterparty ?? "đối tác"}, cách nhau ${dayDiff(g[g.length - 1].date as string, g[0].date as string)} ngày`);
    const severity: Severity = b.exposure >= bigThreshold ? "high" : "medium";
    drafts.push({
      rule: "possible_duplicate_payment",
      severity,
      title: `Nghi thanh toán trùng (${roleLabelShort(role)})`,
      description: `${clusters.length.toLocaleString("vi-VN")} nhóm giao dịch cùng đối tác, cùng số tiền, cách nhau tối đa ${windowDays} ngày nhưng không cùng số chứng từ. Khoản có thể bị chi hai lần: ${fmtMoney(b.exposure)}.`,
      recommendation: "Kiểm tra hợp đồng/đơn đặt hàng và hóa đơn gắn với từng lần chi; yêu cầu nhà cung cấp xác nhận công nợ nếu nghi chi trùng.",
      records: b.records,
      notes: b.notes,
      amount: b.exposure,
    });
  }

  return drafts;
}
