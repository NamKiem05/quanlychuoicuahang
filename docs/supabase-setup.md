# Nối project với Supabase

## 1. Tạo project

Tạo một project Supabase. Trong **Project Settings → API Keys**, lấy Project URL và publishable key. Publishable key được dùng ở trình duyệt; không đặt secret key hoặc service-role key vào biến `NEXT_PUBLIC_*`.

## 2. Điền biến môi trường

Tại thư mục gốc `food-platform`, sao chép `.env.example` thành `.env.local`, rồi thay hai giá trị mẫu bằng thông tin của project. Không đưa `.env.local` lên Git.

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
NEXT_PUBLIC_MAP_TILE_URL=https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}.png
NEXT_PUBLIC_APP_URL=http://localhost:3000
GMAIL_USER=sender@gmail.com
GMAIL_APP_PASSWORD=your_16_character_app_password
```

`GMAIL_APP_PASSWORD` là bí mật phía máy chủ, không thêm tiền tố `NEXT_PUBLIC_`, không dùng mật khẩu Gmail chính và không gửi khóa này trong chat. Xem mục 7 để tạo App Password.

## 3. Tạo bảng, đơn hàng, thanh toán QR, đánh giá và quyền admin

Trong Supabase Dashboard, mở **SQL Editor**. Với project mới, chạy lần lượt các file migration:

- `supabase/migrations/202611140001_initial_schema.sql`
- `supabase/migrations/202611140002_admin_store_status.sql`
- `supabase/migrations/202611140003_guest_orders.sql`
- `supabase/migrations/202611140004_guest_reviews.sql`
- `supabase/migrations/202611140005_product_images.sql`
- `supabase/migrations/202611140006_store_payment_methods.sql`
- `supabase/migrations/202611140007_guest_bank_transfer_orders.sql`
- `supabase/migrations/202611140008_store_delivery_settings.sql`
- `supabase/migrations/202611140009_guest_delivery_orders.sql`
- `supabase/migrations/202611140010_grant_store_delivery_settings.sql`
- `supabase/migrations/202611140011_enable_order_realtime.sql`
- `supabase/migrations/202611140012_store_location_coordinates.sql`
- `supabase/migrations/202611150001_order_email_confirmation.sql`

Nếu project đã chạy migration 001–012, chỉ chạy `202611150001_order_email_confirmation.sql`. Nếu project mới, chạy tất cả file từ 001 đến 012 theo thứ tự rồi chạy migration 013 này. Không chạy lại migration đã áp dụng. Chạy 006 trước 007 và 008 trước 009; mỗi migration đầu thêm một giá trị enum mà migration tiếp theo cần dùng.

Migration bật Row Level Security. Dữ liệu cửa hàng, danh mục, sản phẩm và đánh giá đã phát hành có thể đọc công khai; thông tin đơn hàng chỉ thành viên cửa hàng được đọc qua phiên đăng nhập. Migration thứ ba tạo các hàm RPC giới hạn để khách đặt đơn và tra cứu đơn; migration thứ tư cho phép khách có đơn hoàn tất gửi một đánh giá cho từng món trong đơn. Migration thứ năm tạo bucket ảnh món công khai để khách xem, nhưng chỉ thành viên cửa hàng tương ứng mới được tải ảnh lên hoặc xóa ảnh. Migration 006–007 cấu hình tài khoản ngân hàng và thanh toán QR; cửa hàng xác nhận nhận tiền thủ công. Migration 008–009 cấu hình giao hàng và kiểm tra bán kính ở máy chủ. Migration 010 cấp quyền cập nhật ba cột cài đặt giao hàng; chính sách RLS hiện có vẫn giới hạn cửa hàng mà người dùng được sửa. Migration 011 đưa bảng đơn hàng vào Supabase Realtime; quyền đọc đơn hiện có vẫn giới hạn thông báo theo cửa hàng của người dùng. Migration 012 cung cấp tọa độ đã lưu cho bản đồ chọn vị trí, chỉ cho chủ cửa hàng tương ứng. Migration 013 lưu email khách cùng đơn và cung cấp RPC giới hạn để máy chủ gửi mã xác nhận; các overload RPC đặt hàng cũ bị thu hồi quyền gọi trực tiếp. Đánh giá ở trạng thái chờ duyệt cho đến khi cửa hàng xuất bản. Không mở quyền ghi trực tiếp vào các bảng đơn hàng hoặc đánh giá cho trình duyệt.

## 4. Chạy ứng dụng

Sau khi lưu `.env.local`, khởi động lại `npm run dev`. Mã khởi tạo client đã có tại `src/lib/supabase/`. Nếu chưa điền biến môi trường, proxy sẽ bỏ qua việc làm mới phiên và phần giao diện mẫu vẫn mở được.

## 5. Bật xác nhận email cho đăng ký chủ quán

Nếu bật xác nhận email trong Supabase Auth, thêm `http://localhost:3000/auth/callback` vào danh sách **Redirect URLs** trong cấu hình URL của Auth. Sau đó vào `/login`, chọn đăng ký chủ quán; liên kết xác nhận email sẽ mở phiên đăng nhập và chuyển đến `/dashboard`.

## 6. Cấp quyền admin đầu tiên

Đăng ký tài khoản của bạn tại `/login` trước. Sau đó, trong SQL Editor, chạy câu lệnh dưới đây với email đã đăng ký để cấp quyền quản trị nền tảng cho tài khoản đó. Thay địa chỉ mẫu bằng email của bạn:

```sql
insert into public.platform_admins (user_id)
select id from auth.users where email = lower('you@example.com')
on conflict (user_id) do nothing;
```

Vào `/admin` để xem tổng quan, `/admin/stores` để duyệt cửa hàng, tạm dừng hoặc khóa gian hàng. Không cấp quyền admin cho tài khoản khác nếu bạn không tin cậy người đó.

## 7. Gửi email xác nhận mã đơn

Để thử mà chưa có tên miền, dùng một tài khoản Gmail riêng làm địa chỉ gửi. Bật **Xác minh 2 bước**, sau đó tạo App Password cho Mail trong phần bảo mật tài khoản Google. Điền Gmail vào `GMAIL_USER` và App Password 16 ký tự vào `GMAIL_APP_PASSWORD` trong `.env.local` (có thể nhập liền, ứng dụng tự bỏ dấu cách). Đặt `NEXT_PUBLIC_APP_URL` thành địa chỉ ứng dụng, ví dụ `http://localhost:3000`, để liên kết tra cứu đơn trong email mở đúng nơi. Khởi động lại `npm run dev` sau khi đổi biến môi trường. Hướng dẫn chi tiết: [Google App Passwords](https://support.google.com/accounts/answer/185833) và [Nodemailer dùng Gmail](https://nodemailer.com/guides/using-gmail).

Khi đặt hàng, khách nhập email cùng số điện thoại. Sau khi đơn được tạo, máy chủ dùng mã đơn và số điện thoại để xác thực người nhận rồi gửi mã đơn qua email; nếu Gmail chưa cấu hình hoặc gửi lỗi, mã vẫn hiện trên trang xác nhận để khách lưu lại. Khi cửa hàng xác nhận hoặc từ chối đơn, đánh dấu sẵn sàng, bắt đầu giao, hoàn tất hoặc hủy đơn, khách được email cập nhật trạng thái. Xác nhận thanh toán chuyển khoản cũng gửi email. Nếu gửi email cập nhật lỗi, trạng thái đơn hoặc khoản thanh toán vẫn được lưu và dashboard báo lỗi gửi riêng. Google App Password kém an toàn hơn đăng nhập OAuth và Gmail có thể chặn hoạt động gửi tự động bất thường; đây chỉ là cách thử nghiệm với lưu lượng thấp. Nodemailer cũng không khuyến nghị Gmail cho môi trường production. Khi triển khai thật, nên chuyển sang dịch vụ email giao dịch cùng tên miền đã xác minh.

## Dùng cửa hàng vừa tạo

- `/` là trang tìm cửa hàng. Khách bấm **Dùng vị trí của tôi** để tìm cửa hàng đang hoạt động trong 5 km.
- `/{slug}` là website thực đơn của từng cửa hàng, ví dụ `/bep-ngon`.
- `/track-order` cho khách tra cứu đơn bằng mã đơn và số điện thoại đã đặt.
- Chủ quán chọn hoặc cập nhật vị trí ghim trên bản đồ tại **Dashboard → Cửa hàng → Vị trí cửa hàng**; có thể kéo bản đồ hoặc dùng vị trí hiện tại. Cửa hàng không có ghim sẽ không xuất hiện trong tìm kiếm theo bán kính.
- Khi dashboard cửa hàng đang mở, chuông ở thanh trên nhận đơn mới theo thời gian thực. Có thể bật âm báo và thông báo trình duyệt từ menu chuông; thông báo trình duyệt hoạt động khi tab đang ẩn và người dùng đã cấp quyền.
- Chủ quán có thể chọn ảnh JPG, PNG hoặc WebP tối đa 5 MB trong `/dashboard/menu`; tệp được lưu theo thư mục riêng của từng cửa hàng trong Supabase Storage.
- Đơn mới vào trạng thái **Chờ xác nhận**; chủ quán có thể xác nhận, chuẩn bị, đánh dấu sẵn sàng và hoàn tất đơn trong dashboard. Với đơn giao hàng, dashboard có thêm bước **Bắt đầu giao** rồi **Xác nhận đã giao**.
- Chủ cửa hàng khai báo ngân hàng và số tài khoản trong **Dashboard → Cửa hàng → Thanh toán QR**. Khách chỉ thấy lựa chọn QR khi chủ quán bật phương thức đó. Hệ thống tạo mã QR có sẵn số tiền và nội dung chuyển khoản; chủ quán phải kiểm tra tài khoản ngân hàng rồi bấm **Xác nhận đã nhận tiền** trong trang đơn hàng.
- Chủ cửa hàng có thể bật giao hàng và đặt bán kính 0,5–20 km cùng phí cố định trong **Dashboard → Cửa hàng → Giao hàng**. Cần lưu tọa độ cửa hàng trước khi bật. Khách nhập địa chỉ và chia sẻ vị trí tại nơi nhận; máy chủ kiểm tra khoảng cách đường chim bay rồi tính phí vào tổng đơn. Chủ quán tự giao, chưa có tích hợp đơn vị vận chuyển.
- Bản đồ dùng tile URL trong `NEXT_PUBLIC_MAP_TILE_URL`. Stadia Maps cho phép phát triển trên `localhost` không cần API key; khi chạy domain thật, hãy cấu hình domain hoặc API key theo tài liệu của nhà cung cấp.

## Ghi chú

- Người dùng mới trong Supabase Auth tự có một hàng trong `profiles`.
- Tạo tài khoản chủ cửa hàng chưa tự cấp quyền admin nền tảng.
- Tài khoản admin nền tảng cần được cấp bằng thao tác quản trị riêng, không thông qua giao diện đăng ký công khai.
- Ảnh sản phẩm lưu trong bucket công khai `product-images`; chính sách Storage giới hạn tải lên và xóa theo cửa hàng.
