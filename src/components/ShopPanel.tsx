"use client";

import { tallyChecks } from "@/lib/shop/checks";
import type { AnalysisResult, RuleId } from "@/lib/types";
import { fmtDate } from "@/lib/util/stats";
import ShopFigures from "./ShopFigures";
import ShopMatrix from "./ShopMatrix";
import ShopSources from "./ShopSources";
import { Card, Stat } from "./ui";

interface Props {
  result: AnalysisResult;
  onOpenRules: (rules: RuleId[], label: string) => void;
}

function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-2">
      <div>
        <h3 id={id} className="text-base font-semibold text-slate-900">
          {title}
        </h3>
        {hint ? <p className="text-xs text-slate-700">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

export default function ShopPanel({ result, onOpenRules }: Props) {
  const shop = result.shop;
  if (!shop) return null;
  const tally = tallyChecks(shop.checks);
  const warns = shop.coverage.filter((c) => c.level === "warn");
  const infos = shop.coverage.filter((c) => c.level === "info");
  const coverage = [...warns, ...infos];

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h3 className="text-base font-semibold text-slate-900">Kiểm tiền năm {shop.year}</h3>
        <p className="text-xs text-slate-700">
          Từ {fmtDate(shop.from)} đến ngày có giao dịch mới nhất trong dữ liệu ({fmtDate(shop.asOf)}). Mỗi phép kiểm so các nguồn với nhau; chỗ lệch là dấu hiệu cần xem lại chứng từ, chưa phải kết luận ai sai.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Phép kiểm" value={tally.total} />
          <Stat label="Có lệch" value={tally.issue} />
          <Stat label="Đạt" value={tally.ok} />
          <Stat label="Chưa kiểm được" value={tally.na} hint={tally.na > 0 ? "thiếu dữ liệu, không phải đạt" : undefined} />
        </div>
      </Card>

      {coverage.length > 0 ? (
        <Section
          id="shop-coverage"
          title="Dữ liệu còn thiếu và giới hạn của lần kiểm này"
          hint="Phần này cho biết cần bổ sung gì để các phép kiểm bên dưới đầy đủ hơn."
        >
          <ul className="space-y-2">
            {coverage.map((c, i) => (
              <li
                key={`${c.kind}-${i}`}
                className={`rounded-lg border px-4 py-2.5 text-sm ${c.level === "warn" ? "border-amber-300 bg-amber-50 text-amber-950" : "border-slate-200 bg-slate-50 text-slate-800"}`}
              >
                <p className="font-medium">
                  <span aria-hidden="true">{c.level === "warn" ? "▲ " : "○ "}</span>
                  <span className="sr-only">{c.level === "warn" ? "Cần bổ sung: " : "Ghi chú: "}</span>
                  {c.label}
                </p>
                {c.detail ? <p className="mt-0.5 text-xs">{c.detail}</p> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section id="shop-matrix" title="Kết quả từng phép kiểm theo tháng" hint="Bấm “Xem phát hiện liên quan” để chuyển sang danh sách phát hiện đã lọc theo phép kiểm đó.">
        <ShopMatrix checks={shop.checks} findings={result.findings} year={shop.year} onOpenRules={onOpenRules} />
      </Section>

      {shop.figures.length > 0 ? (
        <Section id="shop-figures" title="Số liệu theo tháng của từng nguồn">
          <ShopFigures figures={shop.figures} year={shop.year} />
        </Section>
      ) : null}

      <Section id="shop-sources" title="Nguồn đã nhận diện">
        <ShopSources sources={shop.sources} ai={result.aiStructure} aiSkipped={result.aiStructureSkipped} />
      </Section>
    </div>
  );
}
