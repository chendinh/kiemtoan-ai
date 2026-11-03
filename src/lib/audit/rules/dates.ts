// Luật về ngày: Chủ nhật/ngày lễ, ngày tương lai, ngoài kỳ kiểm toán, nghi lùi ngày chứng từ.

import type { AuditRecord, Severity } from "@/lib/types";
import { fmtDate, fmtMoney, quantileSorted, sortedCopy } from "@/lib/util/stats";
import { splitSequence } from "@/lib/util/text";
import { addDays, dayDiff, dayOfWeek, isoToMs } from "@/lib/util/values";
import {
  type FindingDraft,
  type RuleContext,
  type SigRegistry,
  recordsOfRole,
  roleLabelShort,
  sortByAmountDesc,
} from "../shared";

// ---------------------------------------------------------------- ngày lễ Việt Nam

const SOLAR_HOLIDAYS: Record<string, string> = {
  "01-01": "Tết Dương lịch",
  "04-30": "Ngày Giải phóng miền Nam",
  "05-01": "Quốc tế Lao động",
  "09-02": "Quốc khánh",
};

let lunarFormatter: Intl.DateTimeFormat | null | undefined;

function getLunarFormatter(): Intl.DateTimeFormat | null {
  if (lunarFormatter !== undefined) return lunarFormatter;
  try {
    lunarFormatter = new Intl.DateTimeFormat("en-u-ca-chinese", { month: "numeric", day: "numeric", timeZone: "UTC" });
  } catch {
    lunarFormatter = null;
  }
  return lunarFormatter;
}

interface Lunar {
  month: number;
  day: number;
  leap: boolean;
}

function lunarOf(iso: string): Lunar | null {
  const fmt = getLunarFormatter();
  if (!fmt) return null;
  try {
    const parts = fmt.formatToParts(new Date(isoToMs(iso)));
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    if (!m || !d) return null;
    const month = parseInt(m, 10);
    const day = parseInt(d, 10);
    if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
    return { month, day, leap: /bis|leap/i.test(m) };
  } catch {
    return null;
  }
}

const holidayCache = new Map<string, string | null>();

/** Tên ngày lễ (nếu có). Lịch âm tính bằng lịch Trung Quốc của ICU, khớp lịch Việt Nam trong hầu hết các năm. */
export function vietnamHoliday(iso: string): string | null {
  const cached = holidayCache.get(iso);
  if (cached !== undefined) return cached;
  let name: string | null = SOLAR_HOLIDAYS[iso.slice(5)] ?? null;
  if (!name) {
    const l = lunarOf(iso);
    if (l && !l.leap) {
      if (l.month === 1 && l.day >= 1 && l.day <= 5) name = "Tết Nguyên đán";
      else if (l.month === 3 && l.day === 10) name = "Giỗ Tổ Hùng Vương";
      else if (l.month === 12 && l.day >= 28) {
        const n1 = lunarOf(addDays(iso, 1));
        const n2 = lunarOf(addDays(iso, 2));
        if ((n1 && n1.month === 1 && n1.day === 1) || (n2 && n2.month === 1 && n2.day === 1)) name = "Tết Nguyên đán (30/29 Tết)";
      }
    }
  }
  holidayCache.set(iso, name);
  return name;
}

// ---------------------------------------------------------------- Chủ nhật / ngày lễ

export function weekendHolidayRule(ctx: RuleContext, registry: SigRegistry): FindingDraft[] {
  const out: FindingDraft[] = [];
  for (const role of ctx.roles) {
    const recs = recordsOfRole(ctx, role).filter((r) => r.date);
    if (recs.length < 10) continue;
    const p75 = quantileSorted(sortedCopy(recs.map((r) => r.amount)), 0.75);
    const floor = Math.max(p75, ctx.settings.minAmount);

    const notes = new Map<string, string>();
    const hits: AuditRecord[] = [];
    for (const r of recs) {
      if (r.amount < floor) continue;
      const date = r.date as string;
      const holiday = vietnamHoliday(date);
      if (holiday) {
        hits.push(r);
        notes.set(r.id, `${holiday} (${fmtDate(date)})`);
      } else if (dayOfWeek(date) === 0) {
        hits.push(r);
        notes.set(r.id, `Chủ nhật (${fmtDate(date)})`);
      }
    }
    if (hits.length === 0) continue;
    if (registry.overlap(hits) >= 0.6) continue;
    registry.claim(hits);

    out.push({
      rule: "weekend_holiday",
      severity: "low",
      title: `Giao dịch lớn vào Chủ nhật/ngày lễ (${roleLabelShort(role)})`,
      description: `${hits.length.toLocaleString("vi-VN")} giao dịch có giá trị từ ${fmtMoney(floor)} trở lên (nhóm 25% lớn nhất) rơi vào Chủ nhật hoặc ngày lễ. Chuyển khoản điện tử vẫn chạy ngày nghỉ, nhưng bút toán nhập tay và chứng từ lập vào ngày nghỉ là chỗ cần xem kỹ.`,
      recommendation: "Xem nhật ký hệ thống (ai đăng nhập, lúc nào) và lý do cần xử lý vào ngày nghỉ.",
      records: sortByAmountDesc(hits),
      notes,
    });
  }
  return out;
}

// ---------------------------------------------------------------- ngày tương lai, ngoài kỳ

export function dateRangeRules(ctx: RuleContext): FindingDraft[] {
  const out: FindingDraft[] = [];

  const future = ctx.records.filter((r) => r.date && r.date > ctx.today);
  if (future.length > 0) {
    const notes = new Map(future.map((r) => [r.id, `Ngày ${fmtDate(r.date)} sau ngày phân tích`] as const));
    const severity: Severity = future.some((r) => r.amount >= ctx.settings.minAmount) ? "medium" : "low";
    out.push({
      rule: "future_date",
      severity,
      title: "Chứng từ ghi ngày ở tương lai",
      description: `${future.length.toLocaleString("vi-VN")} dòng có ngày sau ${fmtDate(ctx.today)}. Có thể là nhập sai năm hoặc ghi nhận trước hạn.`,
      recommendation: "Xác minh ngày thực tế phát sinh; nếu ghi nhận doanh thu/chi phí trước hạn thì cần điều chỉnh.",
      records: sortByAmountDesc(future),
      notes,
    });
  }

  const { periodFrom, periodTo } = ctx.settings;
  if (periodFrom || periodTo) {
    const notes = new Map<string, string>();
    const outside: AuditRecord[] = [];
    for (const r of ctx.records) {
      if (!r.date) continue;
      if (periodFrom && r.date < periodFrom) {
        outside.push(r);
        notes.set(r.id, `Trước kỳ ${fmtDate(periodFrom)} (${dayDiff(periodFrom, r.date)} ngày)`);
      } else if (periodTo && r.date > periodTo) {
        outside.push(r);
        notes.set(r.id, `Sau kỳ ${fmtDate(periodTo)} (${dayDiff(r.date, periodTo)} ngày)`);
      }
    }
    if (outside.length > 0) {
      const big = outside.some((r) => r.amount >= ctx.settings.minAmount);
      out.push({
        rule: "out_of_period",
        severity: big ? "medium" : "low",
        title: "Giao dịch nằm ngoài kỳ kiểm toán",
        description: `${outside.length.toLocaleString("vi-VN")} dòng có ngày nằm ngoài kỳ ${periodFrom ? fmtDate(periodFrom) : "…"} - ${periodTo ? fmtDate(periodTo) : "…"}. Cần xem xét cắt kỳ (cut-off): giao dịch cuối kỳ ghi sang kỳ sau hoặc ngược lại.`,
        recommendation: "Kiểm tra các giao dịch sát ngày cuối kỳ và đầu kỳ sau: chứng từ gốc, biên bản giao nhận, ngày hàng về/kết thúc dịch vụ.",
        records: sortByAmountDesc(outside),
        notes,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- lùi ngày chứng từ

export function backdatedRule(ctx: RuleContext): FindingDraft[] {
  const out: FindingDraft[] = [];
  const tolerance = Math.max(1, ctx.settings.dateWindowDays);

  const groups = new Map<string, { rec: AuditRecord; num: number }[]>();
  for (const r of ctx.records) {
    if (!r.date || r.role === "bank") continue;
    const seq = splitSequence(r.reference);
    if (!seq) continue;
    const key = `${r.fileId}|${r.role}|${r.series ?? ""}|${seq.prefix}|${seq.width}`;
    const g = groups.get(key);
    if (g) g.push({ rec: r, num: seq.num });
    else groups.set(key, [{ rec: r, num: seq.num }]);
  }

  const notes = new Map<string, string>();
  const hits: AuditRecord[] = [];
  for (const g of groups.values()) {
    if (g.length < 10) continue;
    g.sort((a, b) => a.num - b.num);
    let maxDate = g[0].rec.date as string;
    let maxRef = g[0].rec.reference ?? "";
    for (let i = 1; i < g.length; i++) {
      const d = g[i].rec.date as string;
      if (dayDiff(maxDate, d) > tolerance) {
        hits.push(g[i].rec);
        notes.set(g[i].rec.id, `Số ${g[i].rec.reference} ghi ngày ${fmtDate(d)}, trong khi số ${maxRef} đã ghi ngày ${fmtDate(maxDate)} (muộn hơn ${dayDiff(maxDate, d)} ngày)`);
      } else if (d >= maxDate) {
        maxDate = d;
        maxRef = g[i].rec.reference ?? "";
      }
    }
  }
  if (hits.length > 0) {
    out.push({
      rule: "backdated",
      severity: "medium",
      title: "Nghi lùi ngày chứng từ",
      description: `${hits.length.toLocaleString("vi-VN")} chứng từ có số lớn hơn nhưng ghi ngày cũ hơn các chứng từ trước đó hơn ${tolerance} ngày. Chứng từ được cấp số theo thứ tự thời gian nên đây là dấu hiệu lập sau, ghi lùi ngày.`,
      recommendation: "Xem thời điểm tạo thực tế trong hệ thống (log), hỏi người lập; đối chiếu với ngày giao hàng/thanh toán thực tế.",
      records: sortByAmountDesc(hits),
      notes,
    });
  }
  return out;
}
