# Ghi chú tiếp tục dự án

## Dự án

Food platform đa cửa hàng, nơi mỗi cửa hàng có trang bán hàng riêng; khách đặt món từ một cửa hàng mỗi đơn. Quản lý hệ thống và cửa hàng có dashboard riêng.

## Công nghệ

- Next.js 16.4.6, React 19, TypeScript, Tailwind CSS 4
- Supabase cho cơ sở dữ liệu và xác thực
- Nodemailer + Gmail SMTP cho email xác nhận đơn thử nghiệm
- VietQR cho thanh toán chuyển khoản bằng QR

## Tính năng đã có trong mã nguồn

- Trang khám phá món ăn/cửa hàng và trang bán hàng theo cửa hàng
- Quản lý cửa hàng, danh mục, sản phẩm, đơn hàng và đánh giá
- Dashboard admin và dashboard cửa hàng
- Theo dõi đơn bằng mã đơn và số điện thoại
- Chọn vị trí cửa hàng trên bản đồ, cấu hình phương thức giao/nhận
- Thanh toán QR chuyển khoản theo tài khoản do cửa hàng cấu hình
- Email xác nhận đơn bằng Gmail SMTP

## Việc vừa làm

- Chuyển bảng màu giao diện sang xanh lá trong `src/app/globals.css`.
- Chuyển màu thương hiệu trong email xác nhận đơn tại `src/app/api/order-confirmation/route.ts` sang xanh để đồng bộ.
- Thêm nút gửi lại email xác nhận ở màn hình đặt hàng thành công nếu lần gửi đầu thất bại; phần gửi dùng lại cùng API và địa chỉ email đã lưu trong đơn.
- Thêm email cập nhật khi cửa hàng xác nhận/từ chối, đánh dấu sẵn sàng, bắt đầu giao, hoàn tất hoặc hủy đơn; xác nhận thanh toán chuyển khoản cũng báo khách. Nếu email cập nhật thất bại, thao tác lưu đơn vẫn thành công và dashboard báo riêng.
- Trang tra cứu đơn hiện tự gọi RPC tra cứu mỗi 10 giây khi khách đang mở trang và đơn còn hoạt động; tạm dừng khi khách chuyển tab. Dừng cập nhật với đơn đã đóng, ngoại trừ đơn hoàn tất còn chờ xác nhận chuyển khoản.
- Thêm `NEXT_PUBLIC_APP_URL` để liên kết tra cứu trong email dùng đúng địa chỉ ứng dụng; `.env.example` hiện chỉ có giá trị mẫu.
- Đã phát hiện mật khẩu ứng dụng Gmail thật bị đặt nhầm trong `.env.example`, thay bằng giá trị mẫu. Cần thu hồi App Password đó trong Google và tạo khóa mới vì khóa cũ đã nằm trong tệp dự án.
- Zalo có thể được mô phỏng khi phát triển mà không cần giấy tờ; gửi Zalo thật qua API yêu cầu OA doanh nghiệp đã xác thực, kể cả luồng OA Test theo hướng dẫn hiện hành của Zalo.
- Đã mở trang cửa hàng local và xác nhận tông xanh hiển thị. Next.js DevTools vẫn báo `1 Issue`; chưa đọc được nội dung chi tiết.
- Gỡ khai báo `export const runtime = "nodejs"` khỏi route email vì dự án đang bật `cacheComponents: true`; Node.js là runtime mặc định của route handler.
- Chưa chạy build hoặc test sau lần đổi giao diện và bổ sung gửi lại email.

## Cấu hình và dữ liệu nhạy cảm

- `.env.local` chứa cấu hình máy local, gồm thông tin Gmail/Supabase. Không đưa giá trị bí mật vào ghi chú, chat, Git hoặc ảnh chụp màn hình.
- Mẫu biến môi trường ở `.env.example`.
- Cấu hình/migration Supabase được ghi trong `docs/supabase-setup.md`; kiểm tra trạng thái migration trước khi triển khai.
- Gmail App Password mới chỉ được lưu trong `.env.local`; không đưa vào `.env.example`, tài liệu hoặc chat.

## Bắt đầu lại ngày mai

1. Mở lại thư mục `food-platform` trong workspace.
2. Nếu server dev chưa chạy, chạy `npm run dev` trong thư mục dự án.
3. Mở trang khách và dashboard để xem bảng màu mới; nếu thấy màu cũ, tải lại trang.
4. Chọn chức năng tiếp theo cần làm rồi tiếp tục từ mã nguồn hiện tại.

Các thay đổi hiện có đang được lưu trong workspace; chưa tạo Git commit.
