# Kiểm tiền ký gửi · GIVE AWAY PREMIUM

Ứng dụng Next.js kiểm tiền năm 2026 (từ 01/01/2026 đến nay) cho shop ký gửi GIVE AWAY PREMIUM. Chỉ dùng cho shop này. Kiểm hàng chưa có.

## Chạy

```bash
npm install
npm run dev   # mở http://127.0.0.1:3000
```

Dữ liệu chỉ nằm trong bộ nhớ của từng lần phân tích, không lưu xuống đĩa.

## Cách dùng

1. Thêm file (Excel, CSV...) hoặc dán link Google Sheets. Tối đa 40 file, mỗi file 25 MB. Sheet phải để chế độ “bất kỳ ai có đường liên kết đều xem được” thì app mới tải được; tải xong nên đổi lại về riêng tư vì sheet chứa thông tin khách ký gửi.
2. Bấm **Phân tích**. App tự nhận diện từng tab theo tiêu đề cột: bảng lô, danh sách chuyển khoản, sổ thu chi, tổng hợp trả khách theo ngày, doanh thu ngày, báo cáo tháng, file xuất từ hệ thống, sao kê VCB/MB.
3. Tab **Kiểm tiền 2026** cho ma trận phép kiểm theo tháng, dữ liệu còn thiếu, số liệu từng nguồn đặt cạnh nhau và danh sách nguồn đã nhận diện. Bấm “Xem phát hiện liên quan” để sang danh sách phát hiện đã lọc. Nút **Xuất báo cáo Excel** ghi cả các bảng này.

Càng nhiều nguồn và càng đủ tháng thì càng đối chiếu được nhiều. “Chưa kiểm được” nghĩa là thiếu dữ liệu để so, không phải đạt. Phát hiện là dấu hiệu cần xem lại chứng từ, không phải kết luận về gian lận.

## AI (tùy chọn)

Tạo `.env.local` theo mẫu `.env.example` (`AI_API_KEY`, `AI_MODEL`, tùy chọn `AI_PROVIDER`, `AI_BASE_URL`, `AI_TIMEOUT_MS`) rồi khởi động lại server. Không có AI thì mọi phép kiểm vẫn chạy.

- **Nhận diện bảng lạ**: với tab không giống bảng nào đã biết, AI chỉ nhận hồ sơ cột (nhãn tiêu đề, thống kê, mẫu hình ký tự, không có giá trị ô) và đề xuất loại bảng cùng ánh xạ cột. Code kiểm chứng đề xuất trên dữ liệu thật trước khi dùng; AI không tự tính hay ghép số. Bố cục đã duyệt được nhớ theo mẫu bảng trong bộ nhớ tiến trình, mất khi khởi động lại server.
- **Rà soát kết quả**: AI giải thích và xếp ưu tiên các phát hiện. Nên bật “Ẩn danh hóa” trước khi gửi; tên người trong diễn giải tự do có thể vẫn còn sót.

## Cấu hình của shop

- `src/lib/shop/config.ts`: tên người quản lý nhận tiền (để ghép lệnh chuyển trên sao kê), hạn trả (ngày 20), dung sai, đơn vị tiền từng loại bảng.
- `src/lib/shop/period.ts`: năm kiểm tiền.

## Kiểm tra mã nguồn

```bash
npm run typecheck
npm run lint
```
