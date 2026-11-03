"use client";

import { RULE_CATALOG } from "@/lib/audit/catalog";
import type { Finding, ReconciliationSummary } from "@/lib/types";
import { fmtMoney, fmtPct } from "@/lib/util/stats";
import { Card, SeverityBadge, buttonSecondary } from "./ui";

interface Props {
  summaries: ReconciliationSummary[];
  findings: Finding[];
  onOpenFinding: (id: string) => void;
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-600">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-slate-900">{children}</dd>
    </div>
  );
}

export default function ReconciliationPanel({ summaries, findings, onOpenFinding }: Props) {
  const related = findings.filter((f) => RULE_CATALOG[f.rule].category === "reconciliation");

  if (summaries.length === 0) {
    return (
      <Card className="p-5 text-sm text-slate-800">
        <p className="font-semibold">Chưa có cặp nguồn nào để đối chiếu.</p>
        <p className="mt-1">
          Hãy tải lên ít nhất hai loại file, ví dụ <strong>Sổ sách kế toán</strong> (sổ tiền gửi TK 112) cùng <strong>Sao kê ngân hàng</strong>, hoặc thêm <strong>Bảng kê hóa đơn</strong> để đối chiếu với sổ. Kiểm tra cột “Loại” của từng file ở phần tải lên (nếu hệ thống nhận diện sai, hãy chọn lại).
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {summaries.map((s) => {
        const rate = Math.round(s.matchRate * 100);
        return (
          <Card key={s.id} className="p-4">
            <h3 className="text-base font-semibold text-slate-900">
              {s.leftLabel} ↔ {s.rightLabel}
            </h3>
            <div className="mt-3 flex items-center gap-3">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={rate}
                aria-label={`Tỷ lệ giao dịch ${s.leftLabel} khớp với ${s.rightLabel}`}
                className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200"
              >
                <div className={`h-full ${rate >= 90 ? "bg-emerald-600" : rate >= 60 ? "bg-amber-500" : "bg-red-600"}`} style={{ width: `${rate}%` }} />
              </div>
              <span className="w-24 text-right text-sm font-semibold tabular-nums text-slate-900">{fmtPct(s.matchRate)} khớp</span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              <Item label={`Dòng ${s.leftLabel}`}>
                {s.leftCount.toLocaleString("vi-VN")} · {fmtMoney(s.leftAmount)}
              </Item>
              <Item label={`Dòng ${s.rightLabel}`}>
                {s.rightCount.toLocaleString("vi-VN")} · {fmtMoney(s.rightAmount)}
              </Item>
              <Item label="Ghép 1-1">{s.matched.toLocaleString("vi-VN")}</Item>
              <Item label="Ghép nhóm (nhiều ↔ một)">{s.matchedGroups.toLocaleString("vi-VN")}</Item>
              <Item label="Cùng chứng từ, lệch tiền">{s.amountMismatches.toLocaleString("vi-VN")}</Item>
              <Item label={`Chưa khớp: ${s.leftLabel}`}>
                {s.leftUnmatched.toLocaleString("vi-VN")} · {fmtMoney(s.leftUnmatchedAmount)}
              </Item>
              <Item label={`Chưa khớp: ${s.rightLabel}`}>
                {s.rightUnmatchedReported ? (
                  <>
                    {s.rightUnmatched.toLocaleString("vi-VN")} · {fmtMoney(s.rightUnmatchedAmount)}
                  </>
                ) : (
                  <span className="text-xs font-normal text-slate-600">Không xét: {s.rightLabel} có nhiều dòng vốn không có hóa đơn</span>
                )}
              </Item>
            </dl>
          </Card>
        );
      })}

      {related.length > 0 ? (
        <Card className="p-4">
          <h3 className="text-base font-semibold text-slate-900">Phát hiện liên quan đến đối chiếu</h3>
          <ul className="mt-2 divide-y divide-slate-100">
            {related.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 py-2">
                <SeverityBadge severity={f.severity} />
                <span className="min-w-0 flex-1 text-sm text-slate-900">{f.title}</span>
                <span className="text-xs tabular-nums text-slate-700">{f.totalRecords.toLocaleString("vi-VN")} dòng</span>
                <button type="button" className={buttonSecondary} onClick={() => onOpenFinding(f.id)}>
                  Xem chi tiết
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
