import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kiểm tiền ký gửi 2026 · GIVE AWAY PREMIUM",
  description:
    "Công cụ kiểm tiền ký gửi cho shop: đọc bảng lô, sổ thu chi, báo cáo tháng, sao kê và file xuất từ hệ thống (Excel, Google Sheets), đối chiếu chéo và nêu chỗ lệch, thừa, thiếu bằng luật logic kết hợp AI.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
