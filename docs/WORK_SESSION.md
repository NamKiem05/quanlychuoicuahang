# Ghi chú tiếp tục dự án

## Dự án

Food platform đa cửa hàng, nơi mỗi cửa hàng có trang bán hàng riêng; khách đặt món từ một cửa hàng mỗi đơn. Quản lý hệ thống và cửa hàng có dashboard riêng.

## Công nghệ

- Next.js 16.4.6, React 19, TypeScript, Tailwind CSS 4
- Supabase cho cơ sở dữ liệu và xác thực
- Nodemailer + Gmail SMTP cho email xác nhận đơn thử nghiệm
- VietQR cho thanh toán chuyển khoản bằng QR

## Tính năng đã có trong mã nguồn

- Trang gốc giới thiệu nền tảng Gần Đây; khách mua món qua link riêng do chủ cửa hàng chia sẻ. Trang bán hàng theo cửa hàng vẫn ở `/{storeSlug}` và `/store-host/{storeSlug}`.
- Quản lý cửa hàng, danh mục, sản phẩm, đơn hàng và đánh giá
- Dashboard admin và dashboard cửa hàng
- Theo dõi đơn bằng mã đơn và số điện thoại
- Chọn vị trí cửa hàng trên bản đồ, cấu hình phương thức giao/nhận
- Thanh toán QR chuyển khoản theo tài khoản do cửa hàng cấu hình
- Email xác nhận đơn bằng Gmail SMTP
- Mã khuyến mãi theo phần trăm hoặc số tiền với kiểm tra và giới hạn lượt dùng phía máy chủ
- Quản lý tồn kho món tùy chọn; kiểm tra tồn trong giao dịch đặt hàng và hoàn lại nếu đơn bị từ chối/hủy
- Tùy chọn sản phẩm theo nhóm một lựa chọn/nhiều lựa chọn, giá cộng thêm, và lưu cấu hình đã đặt vào tên món chụp trên đơn

## Việc vừa làm

- Chuyển bảng màu giao diện sang xanh lá trong `src/app/globals.css`.
- Chuyển màu thương hiệu trong email xác nhận đơn tại `src/app/api/order-confirmation/route.ts` sang xanh để đồng bộ.
- Thêm nút gửi lại email xác nhận ở màn hình đặt hàng thành công nếu lần gửi đầu thất bại; phần gửi dùng lại cùng API và địa chỉ email đã lưu trong đơn.
- Thêm email cập nhật khi cửa hàng xác nhận/bắt đầu chuẩn bị/từ chối, đánh dấu sẵn sàng, bắt đầu giao, hoàn tất hoặc hủy đơn; xác nhận thanh toán chuyển khoản cũng báo khách. Nếu email cập nhật thất bại, thao tác lưu đơn vẫn thành công và dashboard báo riêng.
- Trang tra cứu đơn hiện tự gọi RPC tra cứu mỗi 10 giây khi khách đang mở trang và đơn còn hoạt động; tạm dừng khi khách chuyển tab. Dừng cập nhật với đơn đã đóng, ngoại trừ đơn hoàn tất còn chờ xác nhận chuyển khoản.
- Đổi thông báo sau thao tác quản lý ở dashboard cửa hàng và các trang quản lý cửa hàng/đánh giá của admin sang Toast; Toast tự ẩn sau 5 giây, lỗi giữ 7 giây, có nút đóng và phân biệt thành công/lỗi/cảnh báo.
- Thêm quản lý mã khuyến mãi tại `/dashboard/promotions`: giảm theo phần trăm hoặc số tiền, đơn tối thiểu, ngày hiệu lực, giới hạn lượt dùng và bật/tắt mã.
- Thu gọn danh sách thực đơn: bấm vào một món để mở biểu mẫu chỉnh sửa, nút ẩn/hiện và nút xóa có xác nhận. Xóa món giữ lại tên/giá đã chụp trong các dòng đơn cũ; ảnh món do cửa hàng tải lên được dọn sau khi xóa.
- Danh sách đơn hàng hiển thị mỗi đơn thành một thẻ rộng một cột để mã đơn, khách hàng và các thao tác không bị chật ở màn hình desktop có sidebar.
- Thêm ô nhập mã ở bước checkout. RPC xem trước tính giảm; RPC tạo đơn kiểm tra lại mã, khóa giới hạn lượt dùng, lưu mã/mức giảm vào đơn và tính lại tổng tiền phía máy chủ.
- Trang tra cứu và danh sách đơn của cửa hàng hiển thị mã cùng số tiền được giảm.
- Migration mới: `supabase/migrations/202611150002_store_promotions.sql`; cần chạy migration 014 trong Supabase trước khi thử tính năng.
- Chưa chạy build hoặc test cho luồng khuyến mãi; cần chạy migration 014 trước khi mở trang cửa hàng để thử.
- Thêm `NEXT_PUBLIC_APP_URL` để liên kết tra cứu trong email dùng đúng địa chỉ ứng dụng; `.env.example` hiện chỉ có giá trị mẫu.
- Đã phát hiện mật khẩu ứng dụng Gmail thật bị đặt nhầm trong `.env.example`, thay bằng giá trị mẫu. Cần thu hồi App Password đó trong Google và tạo khóa mới vì khóa cũ đã nằm trong tệp dự án.
- Zalo có thể được mô phỏng khi phát triển mà không cần giấy tờ; gửi Zalo thật qua API yêu cầu OA doanh nghiệp đã xác thực, kể cả luồng OA Test theo hướng dẫn hiện hành của Zalo.
- Đã mở trang cửa hàng local và xác nhận tông xanh hiển thị. Next.js DevTools vẫn báo `1 Issue`; chưa đọc được nội dung chi tiết.
- Gỡ khai báo `export const runtime = "nodejs"` khỏi route email vì dự án đang bật `cacheComponents: true`; Node.js là runtime mặc định của route handler.
- Chưa chạy build hoặc test sau lần đổi giao diện và bổ sung gửi lại email.
- Rà soát mã nguồn: đã sửa lỗi kiểu trả về RPC tọa độ, React refs/effect trong render, nhãn món mới tính giờ render, và các liên kết nội bộ; `npm run lint` và `npx tsc --noEmit` hiện đều qua. Không tìm thấy script/bộ test tự động; chưa chạy production build để tránh đụng thư mục `.next` của phiên dev đang mở.
- Rà soát trình duyệt: `/dashboard/store` mở được và các điều khiển bản đồ xuất hiện. Chưa kiểm tra migration mới trực tiếp trên Supabase. API gửi lại email xác nhận chưa có giới hạn tần suất; cần bổ sung trước khi mở dịch vụ công khai.
- Thêm quản lý tồn kho tùy chọn cho món: chủ quán nhập số lượng hoặc để trống để không giới hạn; trang cửa hàng và tìm món gần đây đánh dấu món hết hàng, giỏ không cho tăng quá tồn còn lại.
- Migration `supabase/migrations/202611150003_product_inventory.sql` khóa sản phẩm theo thứ tự ổn định và trừ tồn trong giao dịch tạo đơn; đơn bị từ chối hoặc hủy sẽ hoàn lại số lượng. Cần chạy migration 015 trong Supabase trước khi dùng chức năng.
- Chưa chạy build/test hoặc xác thực migration tồn kho trên Supabase.
- Thêm trình quản lý nhóm tùy chọn vào phần chỉnh sửa món. Migration `supabase/migrations/202611150004_product_options.sql` tạo bảng lựa chọn công khai có RLS và RPC chủ cửa hàng để lưu/xóa nhóm; RPC tạo đơn xác thực lựa chọn và cộng giá phía máy chủ.
- Cần chạy migration 016 trong Supabase trước khi thử nhóm tùy chọn; chưa chạy build/test.
- Đổi danh sách món ở **Dashboard → Thực đơn**: bấm **Quản lý món** mở modal giữa màn hình chứa chỉnh sửa sản phẩm và các nhóm tùy chọn; có đóng bằng nút, bấm nền hoặc Escape, khóa cuộn nền và hỗ trợ màn hình điện thoại.
- Trang mua hàng dùng modal căn giữa cho thao tác chọn món, giỏ và checkout; chọn món mở bộ chọn tùy chọn/số lượng, modal hỗ trợ Escape, bấm nền, khóa cuộn và điều hướng bàn phím.
- Thêm **Dashboard → Giao diện** cho chủ quán: tải logo và ảnh bìa lên bucket ảnh có sẵn, chọn một trong bốn màu thương hiệu và xem bản xem trước trước khi lưu. Logo xuất hiện ở đầu và cuối storefront; ảnh bìa vẫn dùng trong phần hero.
- Migration `supabase/migrations/202611150005_store_appearance.sql` thêm `theme_preset` với các lựa chọn xanh lá, cam, xanh dương và đỏ hồng; cần chạy migration 017 trong Supabase trước khi dùng trang này.
- Chỉ vai trò chủ cửa hàng được lưu giao diện; ảnh được kiểm tra thuộc đúng thư mục cửa hàng và ảnh cũ được dọn sau khi lưu thành công.
- Mở rộng **Dashboard → Giao diện**: chủ cửa hàng chọn mẫu cân bằng/thực đơn trước/giới thiệu trước, sắp xếp phần nội dung bằng nút lên/xuống và ẩn/hiện ảnh bìa, đánh giá, giới thiệu. Thực đơn luôn giữ hiển thị để luồng đặt món hoạt động.
- Migration `supabase/migrations/202611150006_storefront_layout.sql` lưu mẫu, thứ tự và các phần ẩn; cần chạy migration 018 sau migration 017. Chủ cửa hàng được xác minh cả khi mở trang lẫn khi gửi thao tác lưu.
- Thêm **Dashboard → Tên miền**: xem slug, địa chỉ phụ nếu nền tảng đã cấu hình, thêm/gỡ tên miền riêng, xem hướng dẫn TXT/CNAME và chủ động kiểm tra DNS. Chỉ vai trò owner mới quản lý được hostname của cửa hàng.
- Migration `supabase/migrations/202611150007_store_domain_verification.sql` tạo token TXT và RPC phân giải hostname riêng đã xác minh. Proxy rewrite trang gốc sang storefront tương ứng cho subdomain nền tảng hoặc custom hostname hợp lệ.
- Cần chạy migration 019 và thêm `SUPABASE_SERVICE_ROLE_KEY`, `STORE_DOMAIN_CNAME_TARGET`; wildcard subdomain cần `NEXT_PUBLIC_PLATFORM_DOMAIN` cùng cấu hình wildcard DNS/SSL. Mỗi custom domain còn phải được khai báo ở nhà cung cấp hosting để cấp HTTPS. Chưa chạy build/test hoặc xác minh DNS/hosting.
- Thêm **Admin → Tên miền**: xem domain toàn hệ thống cùng cửa hàng sở hữu, tìm theo hostname/tên/slug, lọc trạng thái, xem số đang chờ xác minh và gỡ domain có xác nhận. Server action kiểm tra quyền platform admin; RLS hiện có cho phép platform admin đọc và xóa domain nên không cần migration mới.
- Thêm yêu cầu hủy đơn từ trang tra cứu: khách xác minh bằng mã đơn và số điện thoại, nhập lý do, rồi gửi RPC. Cửa hàng thấy yêu cầu trong chi tiết đơn, nhận thông báo realtime và có thể chấp nhận hoặc từ chối; quyết định gửi email cho khách. Chấp nhận sẽ hủy đơn và hoàn kho; chuyển khoản QR cần hoàn tiền thủ công. Migration `supabase/migrations/202611150008_guest_order_cancellation_requests.sql` cần chạy trong Supabase trước khi dùng (migration 020).
- Thêm chat nổi ở dashboard cửa hàng và trang `/admin/messages` cho admin. Admin chọn hội thoại từ danh sách cửa hàng; giao diện chia cột kiểu ứng dụng nhắn tin. Tin nhắn được lưu trong `store_admin_messages`, gửi qua RPC tự xác định vai trò và cập nhật trực tiếp bằng Supabase Realtime. Tin nhắn mới hiện toast và số chưa đọc ở menu/launcher; trình duyệt có thể hiện thông báo nền nếu quyền thông báo đã được cấp. Cần chạy migration `supabase/migrations/202611150009_store_admin_chat.sql` (migration 021) trước khi dùng.
- Thêm webhook SePay tự xác nhận thanh toán QR: khóa riêng từng cửa hàng, API Key xác thực, đối chiếu mã đơn/tài khoản/số tiền, chặn giao dịch trùng và ghi nhật ký webhook. Trạng thái đơn vẫn chờ cửa hàng nhận đơn; chỉ trạng thái thanh toán tự đổi sang đã nhận. Chủ cửa hàng cấu hình ở **Dashboard → Cửa hàng**. Cần chạy migration `supabase/migrations/202611150010_sepay_auto_confirmation.sql` (migration 022); endpoint cần URL HTTPS công khai và tài khoản ngân hàng đã liên kết với SePay.
- 2026-11-16: Đổi trang gốc `/` thành trang giới thiệu nền tảng; bỏ trang tổng hợp cửa hàng khỏi luồng khách. Nội dung nêu rõ khách đặt món từ link cửa hàng.
- 2026-11-16: Đổi trang giới thiệu sang tông xanh dương. Phát hiện CSS Module của trang không tạo class đúng với cấu hình Turbopack hiện tại; đã chuyển style sang `src/app/globals.css` với scope `#platform-home`, đổi JSX sang class tĩnh và xóa `src/app/home-page.module.css`.
- Chưa xác nhận được giao diện sau sửa bằng trình duyệt: trang đang mở vẫn dùng bundle cũ, Edge bị thu nhỏ và preview riêng không truy cập được. Cần khởi động lại máy chủ dev đang dùng cổng 3000, tải lại `/` và xác nhận màu xanh/bố cục; sau đó kiểm tra CTA đăng ký và giữ nguyên link storefront.

## Cấu hình và dữ liệu nhạy cảm

- `.env.local` chứa cấu hình máy local, gồm thông tin Gmail/Supabase. Không đưa giá trị bí mật vào ghi chú, chat, Git hoặc ảnh chụp màn hình.
- Mẫu biến môi trường ở `.env.example`.
- Cấu hình/migration Supabase được ghi trong `docs/supabase-setup.md`; kiểm tra trạng thái migration trước khi triển khai.
- Gmail App Password mới chỉ được lưu trong `.env.local`; không đưa vào `.env.example`, tài liệu hoặc chat.

## Bắt đầu lại ngày mai

1. Mở lại thư mục `food-platform` trong workspace.
2. Khởi động lại Next dev server tại cổng 3000 để nạp CSS vừa sửa. Nếu server cũ vẫn chiếm cổng, dừng nó trong terminal rồi chạy `npm run dev`.
3. Mở `/` và kiểm tra trang giới thiệu có CSS xanh dương; kiểm tra các nút đăng nhập/đăng ký.
4. Xác nhận link riêng `/{storeSlug}` và `/store-host/{storeSlug}` vẫn mở storefront của cửa hàng.
5. Tiếp tục từ mã nguồn hiện tại, không cần làm lại các chức năng đã liệt kê ở trên.

Các thay đổi hiện có đang được lưu trong workspace; chưa tạo Git commit.
