# Nối project với Supabase

## 1. Tạo project

Tạo một project Supabase. Trong **Project Settings → API Keys**, lấy Project URL và publishable key. Publishable key được dùng ở trình duyệt; không đặt secret key hoặc service-role key vào biến `NEXT_PUBLIC_*`.

## 2. Điền biến môi trường

Tại thư mục gốc `food-platform`, sao chép `.env.example` thành `.env.local`, rồi thay hai giá trị mẫu bằng thông tin của project. Không đưa `.env.local` lên Git.

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
NEXT_PUBLIC_MAP_TILE_URL=https://tiles.stadiamaps.com/tiles/outdoors/{z}/{x}/{y}.png
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_PLATFORM_DOMAIN=foodgo.example.com
STORE_DOMAIN_CNAME_TARGET=cname.hosting-provider.example
SUPABASE_SERVICE_ROLE_KEY=server-only-service-role-key
GMAIL_USER=sender@gmail.com
GMAIL_APP_PASSWORD=your_16_character_app_password
```

`GMAIL_APP_PASSWORD` là bí mật phía máy chủ, không thêm tiền tố `NEXT_PUBLIC_`, không dùng mật khẩu Gmail chính và không gửi khóa này trong chat. Xem mục 7 để tạo App Password.
`SUPABASE_SERVICE_ROLE_KEY` cũng là bí mật phía máy chủ: không đưa lên trình duyệt, Git hoặc chat. `NEXT_PUBLIC_PLATFORM_DOMAIN` chỉ bật địa chỉ phụ khi hosting đã có wildcard DNS/SSL phù hợp. `STORE_DOMAIN_CNAME_TARGET` là đích CNAME do nhà cung cấp hosting chỉ định; thay giá trị ví dụ bằng đích thật.

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
- `supabase/migrations/202611150002_store_promotions.sql`
- `supabase/migrations/202611150003_product_inventory.sql`
- `supabase/migrations/202611150004_product_options.sql`
- `supabase/migrations/202611150005_store_appearance.sql`
- `supabase/migrations/202611150006_storefront_layout.sql`
- `supabase/migrations/202611150007_store_domain_verification.sql`
- `supabase/migrations/202611150008_guest_order_cancellation_requests.sql`
- `supabase/migrations/202611150009_store_admin_chat.sql`
- `supabase/migrations/202611150010_sepay_auto_confirmation.sql`

Nếu project đã chạy migration 001–012, chạy tiếp 013 `202611150001_order_email_confirmation.sql`, 014 `202611150002_store_promotions.sql`, 015 `202611150003_product_inventory.sql`, 016 `202611150004_product_options.sql`, 017 `202611150005_store_appearance.sql`, 018 `202611150006_storefront_layout.sql`, 019 `202611150007_store_domain_verification.sql`, 020 `202611150008_guest_order_cancellation_requests.sql`, 021 `202611150009_store_admin_chat.sql`, rồi 022 `202611150010_sepay_auto_confirmation.sql`. Nếu project đã chạy một phần các migration mới, chỉ chạy tiếp các file chưa áp dụng theo thứ tự. Nếu project mới, chạy toàn bộ migration theo thứ tự trên. Không chạy lại migration đã áp dụng. Chạy 006 trước 007 và 008 trước 009; mỗi migration đầu thêm một giá trị enum mà migration tiếp theo cần dùng.

Migration bật Row Level Security. Dữ liệu cửa hàng, danh mục, sản phẩm và đánh giá đã phát hành có thể đọc công khai; thông tin đơn hàng chỉ thành viên cửa hàng được đọc qua phiên đăng nhập. Migration thứ ba tạo các hàm RPC giới hạn để khách đặt đơn và tra cứu đơn; migration thứ tư cho phép khách có đơn hoàn tất gửi một đánh giá cho từng món trong đơn. Migration thứ năm tạo bucket ảnh món công khai để khách xem, nhưng chỉ thành viên cửa hàng tương ứng mới được tải ảnh lên hoặc xóa ảnh. Migration 006–007 cấu hình tài khoản ngân hàng và thanh toán QR; cửa hàng xác nhận nhận tiền thủ công. Migration 008–009 cấu hình giao hàng và kiểm tra bán kính ở máy chủ. Migration 010 cấp quyền cập nhật ba cột cài đặt giao hàng; chính sách RLS hiện có vẫn giới hạn cửa hàng mà người dùng được sửa. Migration 011 đưa bảng đơn hàng vào Supabase Realtime; quyền đọc đơn hiện có vẫn giới hạn thông báo theo cửa hàng của người dùng. Migration 012 cung cấp tọa độ đã lưu cho bản đồ chọn vị trí, chỉ cho chủ cửa hàng tương ứng. Migration 013 lưu email khách cùng đơn và cung cấp RPC giới hạn để máy chủ gửi mã xác nhận; các overload RPC đặt hàng cũ bị thu hồi quyền gọi trực tiếp. Migration 014 tạo bảng mã khuyến mãi, lưu mã và mức giảm vào đơn, xác thực mã và tăng lượt dùng trong cùng giao dịch tạo đơn. Migration 015 cho phép chủ quán quản lý số lượng tồn, khóa và trừ tồn trong giao dịch tạo đơn để tránh bán vượt; nếu đơn bị từ chối hoặc hủy trước khi hoàn tất, số lượng được hoàn lại. Migration 016 tạo nhóm tùy chọn và lựa chọn có giá cộng thêm; RPC đặt hàng xác thực lựa chọn bắt buộc, tính giá và lưu tên lựa chọn cùng giá tại thời điểm đặt. Đánh giá ở trạng thái chờ duyệt cho đến khi cửa hàng xuất bản. Không mở quyền ghi trực tiếp vào các bảng đơn hàng hoặc đánh giá cho trình duyệt.

Migration 017 thêm màu giao diện cho cửa hàng và quyền cập nhật cột này cho người dùng đã đăng nhập; chính sách RLS cửa hàng hiện có vẫn giới hạn cập nhật theo vai trò chủ quán. Logo và ảnh bìa dùng lại bucket `product-images` cùng quy tắc lưu ảnh theo thư mục UUID của cửa hàng.
Migration 018 lưu mẫu bố cục, thứ tự và danh sách phần có thể ẩn trên storefront. Chỉ chủ cửa hàng được lưu bố cục từ dashboard; phần thực đơn luôn hiển thị để khách đặt món.
Migration 019 thêm mã TXT xác minh tên miền và RPC chỉ trả slug của cửa hàng đang hoạt động với hostname đã xác minh. Trong **Dashboard → Tên miền**, chủ quán thêm hostname, tạo TXT `_foodgo-verification.<hostname>` với giá trị `foodgo-verify=<token>` và CNAME trỏ tới `STORE_DOMAIN_CNAME_TARGET`. Máy chủ cần `SUPABASE_SERVICE_ROLE_KEY` để đánh dấu đã xác minh sau khi tự tra DNS. Việc xác minh DNS không tự gắn domain vào nhà cung cấp hosting: thêm từng hostname vào hosting để định tuyến và cấp HTTPS. Để dùng tên miền phụ tự động, cấu hình `NEXT_PUBLIC_PLATFORM_DOMAIN`, wildcard DNS `*` và chứng chỉ wildcard ở hosting.
Migration 020 thêm trạng thái yêu cầu hủy, RPC khách gửi yêu cầu bằng mã đơn/số điện thoại, RPC cửa hàng quyết định, và trường thông tin được trả về trong RPC tra cứu đơn. Yêu cầu đang chờ chặn cửa hàng chuyển đơn sang bước xử lý tiếp; chấp nhận dùng RPC cập nhật trạng thái hiện có để hoàn tồn kho.
Migration 021 tạo luồng chat giữa admin nền tảng và thành viên của từng cửa hàng. Tin nhắn chỉ đọc được bởi admin hoặc thành viên cửa hàng tương ứng; RPC gửi tin tự xác định vai trò người gửi và giới hạn nội dung 2.000 ký tự. Bảng tin nhắn được thêm vào Supabase Realtime để hai phía nhận trao đổi mới khi đang mở trang.

Migration 022 tạo khóa webhook riêng cho từng cửa hàng và endpoint nhận giao dịch SePay. Sau khi nhận webhook có API Key hợp lệ, hệ thống tự đánh dấu kết nối đã bật, rồi chỉ xác nhận thanh toán nếu giao dịch là tiền vào và mã đơn, tài khoản nhận, số tiền khớp; mã giao dịch duy nhất ngăn xử lý lặp. Chủ cửa hàng vẫn cần tự xác nhận nhận đơn; webhook chỉ xác nhận tiền. Để dùng thật, mỗi cửa hàng cần liên kết tài khoản ngân hàng với SePay và cấu hình webhook trỏ tới URL HTTPS công khai của ứng dụng. Thay đổi tài khoản QR hoặc tắt QR sẽ xóa khóa webhook hiện tại; cửa hàng cần tạo và cấu hình khóa mới khi bật lại.

Để bật theo dõi hoàn tiền, chạy `supabase/migrations/202611160011_order_refunds.sql` sau các migration trước đó, gồm `202611160002_platform_admin_read_only_orders.sql` và `202611160009_pickup_ready_estimate.sql`. Đơn QR đã thanh toán chuyển sang **Chờ hoàn tiền** khi bị hủy hoặc từ chối. Sau khi hoàn toàn bộ tiền qua ngân hàng, chủ cửa hàng mở chi tiết đơn để bấm **Đánh dấu đã hoàn tiền**. Khách có thể xem số tiền và thời điểm ghi nhận ở trang **Tra cứu đơn**.

Để thêm ảnh danh mục, chạy `supabase/migrations/202611160012_category_images.sql`. Trong **Dashboard → Thực đơn → Danh mục**, chọn ảnh JPG, PNG hoặc WebP tối đa 5 MB khi tạo danh mục. Ảnh dùng kho `product-images` theo quyền cửa hàng từ migration 005.

## Thanh toán gói dịch vụ cho chủ cửa hàng

1. Chạy `supabase/migrations/202611160013_merchant_plans.sql` sau các migration hiện có. Đặt `MERCHANT_PLAN_BANK_CODE`, `MERCHANT_PLAN_ACCOUNT_NUMBER`, `MERCHANT_PLAN_ACCOUNT_NAME`, `MERCHANT_PLAN_SEPAY_API_KEY` và `SUPABASE_SERVICE_ROLE_KEY` trên máy chủ ứng dụng. Khóa SePay dành riêng cho thanh toán gói phải dài ít nhất 32 ký tự và không có khoảng trắng.
2. Trong SePay Webhooks, chọn tài khoản nhận tiền của nền tảng, giao dịch tiền vào và payload JSON chuẩn. Dùng xác thực API Key với khóa ở bước 1 và URL HTTPS `/api/webhooks/sepay-merchant-plan`. Endpoint này tách riêng khỏi webhook xác nhận đơn của cửa hàng. Cho phép gửi giao dịch có nội dung bắt đầu bằng mã `GGP`; hệ thống tự đọc mã từ nội dung nếu SePay chưa cấu hình nhận diện mã.
3. Thử bằng SePay Test mode trên môi trường kiểm thử với khóa webhook và cơ sở dữ liệu riêng. Đăng ký tài khoản mới, mở QR, mô phỏng khoản tiền đúng và kiểm tra gói tự chuyển sang đang hoạt động. Gửi lại cùng giao dịch và xác nhận hạn sử dụng chỉ tăng một tháng. Thử sai số tiền và kiểm tra gói vẫn chờ thanh toán.

Chủ quán chọn một trong hai gói theo tháng sau khi xác nhận email. Mỗi khoản chuyển đúng mã và số tiền cấp một tháng, tính từ lúc kích hoạt hoặc nối tiếp thời hạn còn lại khi gia hạn. Chủ quán gia hạn thủ công qua QR trong mục **Gói dịch vụ**. Gian hàng mới có thể công khai ngay sau khi tạo và mặc định tắt nhận đơn để chủ quán thiết lập thực đơn trước. Khi hết hạn, cửa hàng tạm dừng nhận đơn mới và khóa các thao tác quản lý tính năng Nâng cao cho đến khi gia hạn. Website vẫn hiển thị và chủ quán vẫn xử lý được đơn đã nhận. Gian hàng tạo trước migration giữ quyền truy cập hiện tại.

[Tích hợp webhook SePay](https://developer.sepay.vn/en/sepay-webhooks/tich-hop-webhook) · [Mô phỏng giao dịch trong SePay Test mode](https://developer.sepay.vn/vi/tien-ich-khac/test-mode/mo-phong-giao-dich)

Chạy thêm `supabase/migrations/202611160014_merchant_plan_upgrades.sql` để bật **Nâng cấp ngay** từ Cơ bản lên Nâng cao. Số tiền được làm tròn lên đến đồng, dựa trên chênh lệch 50.000₫ và thời gian Cơ bản đã trả tiền còn lại. SePay xác nhận đúng số tiền trên QR và giữ nguyên hạn cũ. Với giao dịch đến sau khi mã hết hạn, webhook ghi nhận mã giao dịch và trả `upgrade_paid_after_expiry` để đối soát, còn gói không được kích hoạt.

Sau đó chạy `supabase/migrations/202611160015_cancel_merchant_plan_payment.sql` để bật **Hủy yêu cầu thanh toán**. Nếu có tiền vào theo mã đã hủy, **Admin → Thanh toán gói → Cần đối soát** hiển thị số tiền thực nhận và mã SePay để xử lý. Giao dịch này không kích hoạt, gia hạn hay nâng cấp gói.

## Banner chuyển slide

Chạy `supabase/migrations/202611180001_store_banner_slideshow.sql` sau các migration trước đó. Chủ quán mở **Dashboard → Giao diện → Ảnh thương hiệu**, tải tối đa 3 ảnh rồi bấm **Lưu giao diện**. Mỗi ảnh nhận JPG, PNG hoặc WebP tối đa 5 MB. Ảnh bìa hiện có được giữ làm banner đầu tiên.

Banner tự chuyển mỗi 5 giây, có nút tiến/lùi, chấm chọn ảnh và nút dừng. Tự chuyển tạm ngưng khi rê chuột, chuyển tab hoặc dùng bàn phím trong banner. Thiết bị bật giảm chuyển động sẽ chỉ chuyển khi khách bấm hoặc vuốt. Trang xem trước dùng cùng slideshow với website cửa hàng.

## 4. Chạy ứng dụng

Sau khi lưu `.env.local`, khởi động lại `npm run dev`. Mã khởi tạo client đã có tại `src/lib/supabase/`. Nếu chưa điền biến môi trường, proxy sẽ bỏ qua việc làm mới phiên và phần giao diện mẫu vẫn mở được.

## 5. Bật xác nhận email cho đăng ký chủ quán

Nếu bật xác nhận email trong Supabase Auth, thêm `http://localhost:3000/auth/callback` vào danh sách **Redirect URLs** trong cấu hình URL của Auth. Sau đó vào `/login`, chọn đăng ký chủ quán; liên kết xác nhận email sẽ mở phiên đăng nhập và chuyển đến `/dashboard`.

## 6. Cấp quyền admin đầu tiên

Tạo một người dùng mới dành riêng cho quản trị trong **Supabase → Authentication → Users**. Dùng email riêng với tài khoản cửa hàng. Trong SQL Editor, thay địa chỉ mẫu bằng email quản trị vừa tạo và chạy:

```sql
begin;
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"account_kind":"platform_admin"}'::jsonb
where email = lower('you@example.com');
insert into public.platform_admins (user_id)
select id from auth.users where email = lower('you@example.com')
on conflict (user_id) do nothing;
commit;
```

Chạy `supabase/migrations/202611160016_separate_platform_admin_accounts.sql` sau các migration thanh toán để thực thi phân tách. Migration giữ quyền của admin đã có. Nếu admin cũ từng sở hữu gian hàng, gian hàng vẫn tồn tại nhưng cần bàn giao quyền chủ cửa hàng cho một tài khoản cửa hàng riêng để sử dụng dashboard. Tạo admin tiếp theo trong **Admin → Quản trị viên**.

Vào `/admin` để xem tổng quan, `/admin/stores` để duyệt cửa hàng, tạm dừng hoặc khóa gian hàng.

## 7. Gửi email xác nhận mã đơn

Để thử mà chưa có tên miền, dùng một tài khoản Gmail riêng làm địa chỉ gửi. Bật **Xác minh 2 bước**, sau đó tạo App Password cho Mail trong phần bảo mật tài khoản Google. Điền Gmail vào `GMAIL_USER` và App Password 16 ký tự vào `GMAIL_APP_PASSWORD` trong `.env.local` (có thể nhập liền, ứng dụng tự bỏ dấu cách). Đặt `NEXT_PUBLIC_APP_URL` thành địa chỉ ứng dụng, ví dụ `http://localhost:3000`, để liên kết tra cứu đơn trong email mở đúng nơi. Khởi động lại `npm run dev` sau khi đổi biến môi trường. Hướng dẫn chi tiết: [Google App Passwords](https://support.google.com/accounts/answer/185833) và [Nodemailer dùng Gmail](https://nodemailer.com/guides/using-gmail).

Khi đặt hàng, khách nhập email cùng số điện thoại. Sau khi đơn được tạo, máy chủ dùng mã đơn và số điện thoại để xác thực người nhận rồi gửi mã đơn qua email; nếu Gmail chưa cấu hình hoặc gửi lỗi, mã vẫn hiện trên trang xác nhận để khách lưu lại. Khi cửa hàng xác nhận, bắt đầu chuẩn bị, từ chối đơn, đánh dấu sẵn sàng, bắt đầu giao, hoàn tất hoặc hủy đơn, khách được email cập nhật trạng thái. Xác nhận thanh toán chuyển khoản cũng gửi email. Nếu gửi email cập nhật lỗi, trạng thái đơn hoặc khoản thanh toán vẫn được lưu và dashboard báo lỗi gửi riêng. Google App Password kém an toàn hơn đăng nhập OAuth và Gmail có thể chặn hoạt động gửi tự động bất thường; đây chỉ là cách thử nghiệm với lưu lượng thấp. Nodemailer cũng không khuyến nghị Gmail cho môi trường production. Khi triển khai thật, nên chuyển sang dịch vụ email giao dịch cùng tên miền đã xác minh.

## Dùng cửa hàng vừa tạo

- `/` là trang tìm cửa hàng. Khách bấm **Dùng vị trí của tôi** để tìm cửa hàng đang hoạt động trong 5 km.
- `/{slug}` là website thực đơn của từng cửa hàng, ví dụ `/bep-ngon`.
- `/track-order` cho khách tra cứu đơn bằng mã đơn và số điện thoại đã đặt.
- Chủ quán chọn hoặc cập nhật vị trí ghim trên bản đồ tại **Dashboard → Cửa hàng → Vị trí cửa hàng**; có thể kéo bản đồ hoặc dùng vị trí hiện tại. Cửa hàng không có ghim sẽ không xuất hiện trong tìm kiếm theo bán kính.
- Khi dashboard cửa hàng đang mở, chuông ở thanh trên nhận đơn mới theo thời gian thực. Có thể bật âm báo và thông báo trình duyệt từ menu chuông; thông báo trình duyệt hoạt động khi tab đang ẩn và người dùng đã cấp quyền.
- Chủ quán có thể chọn ảnh JPG, PNG hoặc WebP tối đa 5 MB trong `/dashboard/menu`; tệp được lưu theo thư mục riêng của từng cửa hàng trong Supabase Storage.
- Chủ quán tùy chỉnh logo, ảnh bìa và một trong bốn màu thương hiệu tại **Dashboard → Giao diện**. Cần chạy migration 017; ảnh dùng chung bucket `product-images`, định dạng JPG/PNG/WebP, tối đa 5 MB mỗi ảnh.
- Chủ quán chọn một trong ba mẫu bố cục, sắp xếp lại hoặc ẩn phần ảnh bìa, đánh giá và giới thiệu tại **Dashboard → Giao diện**. Cần chạy migration 018; phần thực đơn luôn giữ hiển thị.
- Khách tra cứu đơn có thể gửi một yêu cầu hủy khi đơn đang chờ xác nhận hoặc đã được xác nhận. Chủ quán nhận thông báo realtime, chấp nhận hoặc từ chối trong chi tiết đơn; chấp nhận sẽ đóng đơn và hoàn lại tồn kho. Với chuyển khoản QR, cửa hàng xử lý hoàn tiền thủ công. Cần chạy migration 020.
- Đơn mới vào trạng thái **Chờ xác nhận**; chủ quán có thể xác nhận, chuẩn bị, đánh dấu sẵn sàng và hoàn tất đơn trong dashboard. Với đơn giao hàng, dashboard có thêm bước **Bắt đầu giao** rồi **Xác nhận đã giao**.
- Chủ cửa hàng khai báo ngân hàng và số tài khoản trong **Dashboard → Cửa hàng → Thanh toán QR**. Khách chỉ thấy lựa chọn QR khi chủ quán bật phương thức đó. Hệ thống tạo mã QR có sẵn số tiền và nội dung chuyển khoản; chủ quán phải kiểm tra tài khoản ngân hàng rồi bấm **Xác nhận đã nhận tiền** trong trang đơn hàng.
- Chủ cửa hàng có thể bật giao hàng và đặt bán kính 0,5–20 km cùng phí cố định trong **Dashboard → Cửa hàng → Giao hàng**. Cần lưu tọa độ cửa hàng trước khi bật. Khách nhập địa chỉ và chia sẻ vị trí tại nơi nhận; máy chủ kiểm tra khoảng cách đường chim bay rồi tính phí vào tổng đơn. Chủ quán tự giao, chưa có tích hợp đơn vị vận chuyển.
- Chủ quán đặt số lượng còn lại cho từng món tại **Dashboard → Thực đơn**; để trống nếu không muốn theo dõi tồn kho. Số lượng giảm khi khách đặt đơn và được hoàn lại nếu cửa hàng từ chối hoặc hủy đơn.
- Chủ quán thêm nhóm size/topping trong phần **Tùy chọn món** khi mở một món trong **Dashboard → Thực đơn**. Nhập mỗi lựa chọn trên một dòng theo dạng `Tên|Giá cộng thêm`; khách chọn các tùy chọn này trước khi thêm món vào giỏ. Mỗi món hỗ trợ tối đa 40 nhóm, mỗi nhóm tối đa 20 lựa chọn; máy chủ kiểm tra tối đa 40 lựa chọn đã chọn cho một món trong đơn. Tồn kho hiện được tính chung theo món, chưa tách theo size.
- Chủ cửa hàng tạo mã theo phần trăm hoặc số tiền trong **Dashboard → Khuyến mãi**; có thể đặt đơn tối thiểu, ngày hết hạn và số lượt dùng. Mã được kiểm tra lại trong giao dịch tạo đơn; mức giảm chỉ trừ vào tiền món, không trừ phí giao hàng.
- Bản đồ dùng tile URL trong `NEXT_PUBLIC_MAP_TILE_URL`. Stadia Maps cho phép phát triển trên `localhost` không cần API key; khi chạy domain thật, hãy cấu hình domain hoặc API key theo tài liệu của nhà cung cấp.

## Ghi chú

- Quản lý nhân viên cửa hàng cần migration `202611180027_store_staff_invitations.sql` và `202611180029_remove_owner_create_staff.sql` sau các migration trước đó. Chủ cửa hàng tạo lời mời và hệ thống gửi email qua SMTP ứng dụng; cần cấu hình SMTP và `NEXT_PUBLIC_APP_URL` là địa chỉ HTTPS công khai. Riêng khi chạy môi trường phát triển có thể dùng `http://localhost:3000` để thử trên cùng máy; liên kết này không hoạt động trên thiết bị khác. Người nhận đăng nhập bằng tài khoản có email đã xác minh và tự chấp nhận tại `/staff-invitations`; lời mời hết hạn sau 7 ngày. Xác minh email tài khoản vẫn phụ thuộc SMTP của Supabase Auth. Nếu gửi email mời thất bại, lời mời vẫn được lưu và có thể gửi lại trong danh sách. Chỉ vai trò `staff` hiện có được cấp; chưa có phân quyền chi tiết hoặc kiểm tra giới hạn nhân viên theo gói. Migration thu hồi quyền ghi trực tiếp `store_members` của `authenticated`; cần thử các tích hợp đang ghi trực tiếp bảng này trước khi triển khai.

- Box vận hành cần migration `202611180026_platform_operations.sql` sau migration thông báo. Chế độ bảo trì áp dụng tại proxy KingWeb và không chặn Supabase trực tiếp; Admin, đăng nhập và webhook được miễn để tránh khóa quản trị hoặc bỏ sót thanh toán. Nếu không đọc được cấu hình thì proxy tiếp tục cho truy cập. Công tắc đăng ký được kiểm tra bằng trigger trên `auth.users`, ngoại trừ tài khoản do Admin tạo; trước khi triển khai cần thử cả đăng ký và tạo nhân viên trên môi trường thử nghiệm. Giới hạn ký tự chỉ áp dụng cho thông báo nền tảng mới.

- Box lưu trữ và sao lưu cần migration `202611180025_platform_storage_settings.sql` và service role để đọc thông tin bucket. Lịch, thời hạn lưu giữ và ghi chú là kế hoạch do admin lưu, không kích hoạt sao lưu tự động hoặc tự xóa tệp. Dung lượng sử dụng/hạn mức dự án và trạng thái sao lưu tự động chưa được đồng bộ; kết quả sao lưu trong ứng dụng do admin ghi nhận.

- Box cấu hình thông báo cần migration `202611180024_platform_notification_settings.sql`. Công tắc chỉ kiểm soát tạo thông báo nền tảng mới trong ứng dụng; mẫu bảo trì và thanh toán được chọn thủ công ở trang Quản lý thông báo. Các thông báo đã gửi vẫn giữ nguyên. Email nền tảng và thông báo tự động đăng ký, bảo trì, thanh toán chưa được tích hợp.

- Cấu hình bảo mật nhân viên cần migration `202611180023_platform_security_settings.sql`. Độ dài mật khẩu chỉ áp dụng khi tạo nhân viên trong Admin; không thay thế chính sách mật khẩu toàn dự án trên Supabase Auth. Thời hạn phiên, giới hạn Auth, xác minh email và MFA cần thiết lập riêng; ứng dụng chưa có luồng xác minh MFA hay danh sách IP cho Admin.

- Cấu hình thanh toán gói dịch vụ cần migration `202611180022_platform_payment_settings.sql`. Bật/tắt chỉ ảnh hưởng việc tạo yêu cầu mới; webhook vẫn đối soát yêu cầu đã tạo. Thông tin ngân hàng và khóa webhook SePay vẫn được cấu hình bằng biến môi trường phía máy chủ; mục kiểm tra chỉ xác nhận cấu hình nội bộ, không xác minh kết nối hoặc giao dịch SePay.

- Cấu hình SMTP trong Admin cần migration `202611180021_platform_email_settings.sql`, biến `SUPABASE_SERVICE_ROLE_KEY` và khóa `SMTP_SETTINGS_ENCRYPTION_KEY` trên máy chủ. Tạo khóa một lần bằng `node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))"`, lưu bí mật trong môi trường triển khai và giữ nguyên khi khởi động lại; thay hoặc mất khóa sẽ khiến mật khẩu SMTP đã lưu không giải mã được. Không đưa khóa vào mã nguồn. Cấu hình này dùng cho email đơn hàng; xác minh và đặt lại mật khẩu của Supabase Auth phải cấu hình SMTP riêng trong Supabase. SMTP hỗ trợ máy chủ công khai qua cổng 465, 587 hoặc 2525 với TLS.

- Tổng quan chủ cửa hàng cần migration `202611180017_merchant_overview.sql` (sau các migration trước đó). Doanh thu tính theo thanh toán đã xác nhận; khách hàng được phân biệt theo số điện thoại trong đơn, và khách mới tính theo đơn đầu tiên trong tháng. Xếp hạng doanh thu sản phẩm chưa phân bổ giảm giá, phí giao hàng hoặc hoàn tiền. Các hoạt động gần đây hiện là đơn hàng gần đây.

- Người dùng mới trong Supabase Auth tự có một hàng trong `profiles`.
- Tạo tài khoản chủ cửa hàng chưa tự cấp quyền admin nền tảng.
- Tài khoản admin nền tảng cần được cấp bằng thao tác quản trị riêng, không thông qua giao diện đăng ký công khai.
- Ảnh sản phẩm lưu trong bucket công khai `product-images`; chính sách Storage giới hạn tải lên và xóa theo cửa hàng.
