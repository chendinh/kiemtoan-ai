"use client";

import type { AiStatus } from "@/lib/types";
import type { SettingsForm } from "@/lib/client/settings";
import { SHOP_FROM } from "@/lib/shop/period";
import { fmtDate } from "@/lib/util/stats";
import { inputClass } from "./ui";

/** Các ô nhập chữ của biểu mẫu (không gồm công tắc chế độ shop). */
type TextKey = Exclude<keyof SettingsForm, "shopMode">;

interface Props {
  form: SettingsForm;
  onChange: (patch: Partial<SettingsForm>) => void;
  disabled?: boolean;
  aiStatus: AiStatus | null;
  useAi: boolean;
  onUseAi: (v: boolean) => void;
  anonymize: boolean;
  onAnonymize: (v: boolean) => void;
  useAiStructure: boolean;
  onUseAiStructure: (v: boolean) => void;
}

const fieldInput = `${inputClass} disabled:bg-slate-100 disabled:text-slate-500`;

function Field({
  id,
  label,
  help,
  off,
  children,
}: {
  id: string;
  label: string;
  help: string;
  /** Ô này không có tác dụng ở chế độ hiện tại. */
  off?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className={`block text-sm font-medium ${off ? "text-slate-600" : "text-slate-900"}`}>
        {label}
      </label>
      <div className="mt-1">{children}</div>
      <p id={`${id}-help`} className="mt-1 text-xs text-slate-600">
        {help}
        {off ? " Không có tác dụng khi bật chế độ shop (luật này đã tắt)." : ""}
      </p>
    </div>
  );
}

export default function SettingsPanel({
  form,
  onChange,
  disabled,
  aiStatus,
  useAi,
  onUseAi,
  anonymize,
  onAnonymize,
  useAiStructure,
  onUseAiStructure,
}: Props) {
  const aiReady = !!aiStatus?.configured;
  const shop = form.shopMode;
  const text = (id: TextKey, off = false) => ({
    id: `set-${id}`,
    value: form[id],
    disabled: disabled || off,
    "aria-describedby": `set-${id}-help`,
    className: fieldInput,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ [id]: e.target.value }),
  });

  return (
    <div className="space-y-6">
      <fieldset className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
        <legend className="px-1 text-sm font-semibold text-slate-900">Chế độ shop ký gửi</legend>
        <div className="flex items-start gap-3">
          <input
            id="shop-mode"
            type="checkbox"
            checked={shop}
            disabled={disabled}
            onChange={(e) => onChange({ shopMode: e.target.checked })}
            className="mt-1 h-4 w-4 rounded border-slate-400 text-indigo-600"
            aria-describedby="shop-mode-help"
          />
          <div>
            <label htmlFor="shop-mode" className="text-sm font-medium text-slate-900">
              Kiểm tiền theo cách của shop ký gửi (khuyến nghị)
            </label>
            <p id="shop-mode-help" className="text-xs text-slate-700">
              Tự nhận diện bảng lô, danh sách chuyển khoản, sổ thu chi, báo cáo tháng, doanh thu ngày, file xuất từ hệ thống và sao kê rồi đối chiếu chéo các nguồn từ {fmtDate(SHOP_FROM)}. Các luật thống kê (Benford, số tiền tròn, ngày nghỉ, giá trị lớn, tách nhỏ giao dịch, từ khóa…) bị tắt vì với hàng nghìn khoản chuyển nhỏ của khách chúng chỉ báo động giả. Hãy tắt chế độ này nếu bạn đang kiểm file không phải của shop.
            </p>
          </div>
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="set-thresholds"
          label="Ngưỡng phê duyệt / ngưỡng cần canh (VND)"
          help={
            shop
              ? "Mỗi ngưỡng một dòng hoặc cách nhau dấu chấm phẩy. Ở chế độ shop, ngưỡng lớn nhất chỉ dùng để xếp mức độ của phát hiện trùng thanh toán và khoản chưa ghép được."
              : "Mỗi ngưỡng một dòng hoặc cách nhau dấu chấm phẩy. Dùng để bắt hiện tượng dồn số tiền sát dưới ngưỡng và tách nhỏ giao dịch."
          }
        >
          <textarea {...text("thresholds")} rows={3} />
        </Field>
        <div className="grid gap-4">
          <Field
            id="set-periodFrom"
            label="Kỳ kiểm toán: từ ngày"
            help={
              shop
                ? `Dùng cho luật “giao dịch ngoài kỳ” (ví dụ sao kê có dòng trước ${fmtDate(SHOP_FROM)}). Các phép kiểm tiền của shop luôn tính từ ${fmtDate(SHOP_FROM)}, giá trị này đặt trong mã nguồn chứ không đổi ở đây.`
                : "Bỏ trống nếu không cần kiểm tra cắt kỳ."
            }
          >
            <input {...text("periodFrom")} type="date" />
          </Field>
          <Field id="set-periodTo" label="Kỳ kiểm toán: đến ngày" help="Để trống là đến hiện tại. Giao dịch ngoài kỳ sẽ được liệt kê.">
            <input {...text("periodTo")} type="date" />
          </Field>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field id="set-tolerance" label="Dung sai số tiền khi đối chiếu (VND)" help="0 = phải khớp tuyệt đối.">
          <input {...text("tolerance")} inputMode="decimal" />
        </Field>
        <Field id="set-dateWindow" label="Lệch ngày tối đa khi ghép (ngày)" help="Ngân hàng thường ghi nhận muộn vài ngày so với sổ sách.">
          <input {...text("dateWindow")} inputMode="numeric" />
        </Field>
        <Field id="set-minAmount" label="Bỏ qua khoản nhỏ hơn (VND)" help="Áp dụng cho các luật dễ gây nhiễu: trùng thanh toán, bất thường, từ khóa.">
          <input {...text("minAmount")} inputMode="numeric" />
        </Field>
        <Field id="set-band" label="Độ rộng dải sát ngưỡng (%)" help="5 = dải từ 95% đến 100% của ngưỡng." off={shop}>
          <input {...text("band", shop)} inputMode="decimal" />
        </Field>
        <Field id="set-splitWindow" label="Cửa sổ nghi tách giao dịch (ngày)" help="Các khoản cùng đối tác trong số ngày này được gom lại xét." off={shop}>
          <input {...text("splitWindow", shop)} inputMode="numeric" />
        </Field>
        <Field id="set-duplicateWindow" label="Cửa sổ nghi thanh toán trùng (ngày)" help="Cùng đối tác, cùng số tiền, cách nhau không quá số ngày này.">
          <input {...text("duplicateWindow")} inputMode="numeric" />
        </Field>
        <Field id="set-roundUnit" label="Đơn vị số tiền tròn (VND)" help="Ví dụ 1.000.000: số chia hết cho đơn vị này coi là tròn." off={shop}>
          <input {...text("roundUnit", shop)} inputMode="numeric" />
        </Field>
        <div className="sm:col-span-2">
          <Field
            id="set-keywords"
            label="Từ khóa rủi ro bổ sung"
            help="Cách nhau dấu phẩy hoặc chấm phẩy, không cần gõ dấu. Ví dụ: sửa chữa, tư vấn, phí môi giới."
            off={shop}
          >
            <input {...text("keywords", shop)} />
          </Field>
        </div>
      </div>

      <fieldset className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <legend className="px-1 text-sm font-semibold text-slate-900">Rà soát bằng AI (tùy chọn)</legend>
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <input
              id="use-ai"
              type="checkbox"
              checked={useAi && aiReady}
              disabled={disabled || !aiReady}
              onChange={(e) => onUseAi(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-slate-400 text-indigo-600"
              aria-describedby="use-ai-help"
            />
            <div>
              <label htmlFor="use-ai" className="text-sm font-medium text-slate-900">
                Dùng AI để nhận xét thêm sau khi phân tích
              </label>
              <p id="use-ai-help" className="text-xs text-slate-700">
                {aiStatus === null
                  ? "Đang kiểm tra cấu hình AI…"
                  : aiReady
                    ? `Đã cấu hình: ${aiStatus.provider} · ${aiStatus.model}. Khi bật, tóm tắt kết quả và một số dòng liên quan sẽ được gửi tới nhà cung cấp AI này.`
                    : "Chưa cấu hình. Tạo file .env.local với AI_API_KEY và AI_MODEL (xem .env.example) rồi khởi động lại server. Các luật logic vẫn chạy đầy đủ khi không có AI."}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <input
              id="anonymize"
              type="checkbox"
              checked={anonymize}
              disabled={disabled || !aiReady}
              onChange={(e) => onAnonymize(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-slate-400 text-indigo-600"
              aria-describedby="anonymize-help"
            />
            <div>
              <label htmlFor="anonymize" className="text-sm font-medium text-slate-900">
                Ẩn danh hóa trước khi gửi (khuyến nghị)
              </label>
              <p id="anonymize-help" className="text-xs text-slate-700">
                Tên đối tác và tên file được thay bằng mã (ĐT-001, F1), các dãy số từ 8 chữ số trở lên (số tài khoản, MST) bị che. Tên người nằm lẫn trong diễn giải tự do có thể vẫn còn.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <input
              id="use-ai-structure"
              type="checkbox"
              checked={useAiStructure && aiReady && shop}
              disabled={disabled || !aiReady || !shop}
              onChange={(e) => onUseAiStructure(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-slate-400 text-indigo-600"
              aria-describedby="use-ai-structure-help"
            />
            <div>
              <label htmlFor="use-ai-structure" className="text-sm font-medium text-slate-900">
                Dùng AI để nhận diện bảng lạ
              </label>
              <p id="use-ai-structure-help" className="text-xs text-slate-700">
                Khi một tab không giống bảng nào đã biết (đổi tiêu đề cột, thêm cột), AI nhận hồ sơ cột của tab đó (nhãn tiêu đề, thống kê, mẫu hình ký tự, không có giá trị ô) và đề xuất cách đọc. Code kiểm chứng đề xuất trên dữ liệu thật trước khi dùng; AI không tự tính hay ghép số.
                {!shop ? " Chỉ dùng được khi bật chế độ shop." : ""}
                {shop && !aiReady && aiStatus !== null ? " Cần cấu hình AI trước." : ""}
              </p>
            </div>
          </div>
        </div>
      </fieldset>
    </div>
  );
}
