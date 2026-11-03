// Từ khóa rủi ro trong diễn giải (gợi ý chọn mẫu, không phải kết luận).

import type { AuditRecord } from "@/lib/types";
import { fmtMoney } from "@/lib/util/stats";
import { normText } from "@/lib/util/text";
import { type FindingDraft, type RuleContext, roleLabelShort, sortByAmountDesc } from "../shared";

interface Category {
  id: string;
  label: string;
  keywords: string[];
}

const CATEGORIES: Category[] = [
  { id: "cash", label: "Tiền mặt / rút tiền", keywords: ["tien mat", "rut tien", "nop tien mat", "cash", "atm"] },
  { id: "advance", label: "Tạm ứng / hoàn ứng", keywords: ["tam ung", "hoan ung", "advance"] },
  {
    id: "adjust",
    label: "Điều chỉnh / hủy / đảo bút toán",
    keywords: ["dieu chinh", "huy bo", "huy hoa don", "huy giao dich", "dao but toan", "hoan tien", "reversal", "adjustment", "void", "refund", "write off", "xoa no", "xoa so"],
  },
  {
    id: "benefit",
    label: "Hoa hồng / chiết khấu / quà tặng",
    keywords: ["hoa hong", "chiet khau", "qua tang", "tiep khach", "commission", "gift", "kickback", "rebate"],
  },
  {
    id: "related",
    label: "Vay mượn / bên liên quan",
    keywords: ["cho vay", "vay ca nhan", "muon tien", "ung truoc tien", "loan", "ben lien quan", "related party"],
  },
];

export function keywordRule(ctx: RuleContext): FindingDraft[] {
  const out: FindingDraft[] = [];
  const categories = [...CATEGORIES];
  const custom = ctx.settings.keywords.map((k) => normText(k)).filter((k) => k.length >= 2);
  if (custom.length > 0) categories.push({ id: "custom", label: "Từ khóa do bạn nhập", keywords: custom });

  const candidates = ctx.positive.filter((r) => r.description && r.amount >= ctx.settings.minAmount);
  const normalized = new Map<string, string>();
  for (const r of candidates) normalized.set(r.id, ` ${normText(r.description as string)} `);

  for (const cat of categories) {
    const hits: AuditRecord[] = [];
    const notes = new Map<string, string>();
    for (const r of candidates) {
      const n = normalized.get(r.id) as string;
      const kw = cat.keywords.find((k) => n.includes(` ${k} `));
      if (kw) {
        hits.push(r);
        notes.set(r.id, `Có từ khóa "${kw}"`);
      }
    }
    if (hits.length === 0) continue;
    const roles = [...new Set(hits.map((h) => roleLabelShort(h.role)))].join(", ");
    const total = hits.reduce((s, r) => s + r.amount, 0);
    out.push({
      rule: "risk_keyword",
      severity: "low",
      title: `Từ khóa rủi ro: ${cat.label}`,
      description: `${hits.length.toLocaleString("vi-VN")} giao dịch từ ${fmtMoney(ctx.settings.minAmount)} trở lên có diễn giải thuộc nhóm "${cat.label}" (tổng ${fmtMoney(total)}; nguồn: ${roles}). Đây chỉ là gợi ý chọn mẫu kiểm tra.`,
      recommendation: "Chọn mẫu các khoản lớn nhất trong nhóm, xem chứng từ đi kèm và người phê duyệt.",
      records: sortByAmountDesc(hits),
      notes,
      amount: total,
    });
  }
  return out;
}
