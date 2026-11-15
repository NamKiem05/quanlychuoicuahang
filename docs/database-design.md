# Thiết kế dữ liệu MVP

Mô hình này phục vụ nền tảng nhiều cửa hàng. Dữ liệu ứng dụng dùng chung một PostgreSQL database; mọi bảng thuộc dữ liệu cửa hàng đều gắn với `store_id` để truy vấn và phân quyền theo cửa hàng.

## Các thực thể chính

| Bảng | Dùng để lưu |
| --- | --- |
| `profiles` | Thông tin hiển thị của người dùng; danh tính đăng nhập do Supabase Auth quản lý |
| `stores` | Tên, slug, địa chỉ, tọa độ, trạng thái, liên hệ, giao hàng, logo, ảnh bìa, màu sắc và bố cục storefront |
| `store_members` | Thành viên và vai trò trong từng cửa hàng (`owner`, `staff`) |
| `store_domains` | Tên miền phụ và tên miền riêng đã được gắn với cửa hàng |
| `store_promotions` | Mã khuyến mãi, mức giảm, thời gian hiệu lực và lượt sử dụng |
| `categories` | Danh mục sản phẩm của một cửa hàng |
| `products` | Tên, mô tả, giá, ảnh, tồn kho và trạng thái bán |
| `product_option_groups` | Nhóm lựa chọn một/nhiều như kích cỡ hoặc topping, có thể bắt buộc |
| `product_options` | Giá trị lựa chọn và khoản giá cộng thêm |
| `orders` | Thông tin khách, cửa hàng, tổng tiền, phương thức nhận, trạng thái đơn/thanh toán và yêu cầu hủy |
| `store_payment_methods` | Ngân hàng và tài khoản nhận tiền QR do chủ cửa hàng cấu hình |
| `store_sepay_webhook_keys` | Hash khóa webhook SePay riêng của từng cửa hàng; chỉ máy chủ được đọc |
| `bank_transfer_webhook_events` | Nhật ký giao dịch webhook, chống xử lý trùng và lưu kết quả đối chiếu |
| `store_admin_messages` | Tin nhắn giữa admin nền tảng và thành viên của cửa hàng; phân quyền đọc theo cửa hàng |
| `order_items` | Sản phẩm, số lượng và bản chụp tên/giá tại thời điểm đặt hàng |
| `reviews` | Đánh giá gắn với sản phẩm đã mua trong đơn hoàn tất |

## Quan hệ

```text
profiles ──< store_members >── stores ──< store_domains
                                  │
                                  ├──< categories ──< products
                                  ├──< products
                                  ├──< store_promotions
                                  ├──< store_payment_methods
                                  ├──── store_sepay_webhook_keys
                                  └──< bank_transfer_webhook_events
                                  └──< orders ──< order_items >── products
                                                     │
                                                     └── reviews
                                  └──< store_admin_messages
```

Một đơn hàng thuộc đúng một cửa hàng. `order_items` giữ `product_name_snapshot` và `unit_price_snapshot`, vì tên hoặc giá sản phẩm có thể thay đổi sau khi khách đặt. Đơn giao tận nơi lưu địa chỉ, tọa độ, khoảng cách và phí giao hàng tại thời điểm đặt. Nếu dùng mã khuyến mãi, đơn lưu mã và số tiền giảm làm bản chụp; tổng thanh toán bằng tiền món cộng phí giao trừ mức giảm.

## Trạng thái đơn hàng

Luồng cơ bản đề xuất:

```text
pending → confirmed → preparing → ready → completed (nhận tại cửa hàng)
                                  └→ out_for_delivery → completed (giao hàng)
    └──────────────→ cancelled
```

Trạng thái `rejected` có thể dùng nếu cửa hàng từ chối đơn trước khi xác nhận. Chỉ đơn `completed` mới được đánh giá. Đơn giao chuyển từ `ready` sang `out_for_delivery` trước khi cửa hàng đánh dấu hoàn tất.

## Dữ liệu đơn khách vãng lai

Khách chưa cần tài khoản. `orders` lưu tên và số điện thoại liên hệ; khách tra cứu bằng mã đơn ngẫu nhiên kết hợp số điện thoại. Mã đơn không nên là số tăng dần dễ đoán. Cần giới hạn số lần tra cứu ở API để giảm việc dò mã.

Khách chỉ gửi yêu cầu hủy khi đơn đang chờ xác nhận hoặc đã xác nhận; cửa hàng chấp nhận hoặc từ chối. Yêu cầu đang chờ sẽ khóa bước xử lý tiếp theo cho đến khi cửa hàng quyết định. Chấp nhận hủy dùng cùng RPC cập nhật đơn để hoàn tồn kho. Hệ thống không tự hoàn tiền QR; cửa hàng xử lý hoàn tiền thủ công.

## Vị trí và tên miền

- Lưu vĩ độ và kinh độ cửa hàng trong `stores`; dùng PostGIS để tìm cửa hàng trong phạm vi 5 km.
- Migration ban đầu thêm RPC `find_nearby_stores(latitude, longitude)` để trả tối đa 50 cửa hàng đang hoạt động trong bán kính 5 km.
- Trang tìm cửa hàng không lưu tọa độ khách; khi khách đặt giao hàng, đơn cần lưu vị trí nhận để cửa hàng giao đúng địa chỉ.
- Khi đặt giao hàng, cần lưu tọa độ giao cùng đơn để cửa hàng biết điểm nhận và kiểm tra giới hạn giao hàng. MVP dùng khoảng cách đường chim bay và phí cố định do cửa hàng đặt; chưa tính đường đi thực tế.
- `store_domains` lưu hostname duy nhất, cửa hàng sở hữu hostname đó, loại (`subdomain` hoặc `custom`), trạng thái xác minh và mã TXT ngẫu nhiên. `resolve_custom_store_hostname` chỉ công khai slug của cửa hàng đang hoạt động có hostname riêng đã xác minh; việc cấp HTTPS do hosting xử lý.
- Slug và hostname cần ràng buộc duy nhất để tránh hai cửa hàng nhận cùng địa chỉ.

## Ràng buộc và phân quyền

- Bảng sản phẩm, danh mục, đơn, tên miền và đánh giá đều gắn với cửa hàng.
- Mọi thao tác quản lý phải kiểm tra thành viên của `store_id` ở phía máy chủ; admin nền tảng có quyền riêng.
- Bật PostgreSQL Row Level Security trước khi dùng dữ liệu thật. Không dựa vào việc ẩn cửa hàng khác ở giao diện.
- Dùng `numeric`/`integer` theo đơn vị đồng cho giá và tổng tiền; tránh số thực dấu phẩy động.
- Xóa cửa hàng/sản phẩm cần quy tắc riêng. Đơn hàng cũ nên được giữ để tra cứu và đối soát.

## Thanh toán QR chuyển khoản

- Mỗi cửa hàng có thể cấu hình một tài khoản nhận tiền trong `store_payment_methods`; chỉ chủ cửa hàng mới được sửa. Thông tin tài khoản chỉ được đọc công khai khi cửa hàng bật thanh toán QR.
- Khóa webhook lưu dưới dạng SHA-256 trong `store_sepay_webhook_keys`, bảng này không cấp quyền đọc/ghi cho trình duyệt. `bank_transfer_webhook_events` có unique key theo nhà cung cấp và mã giao dịch; RPC máy chủ chỉ đánh dấu `orders.payment_status = 'paid'` nếu mã đơn, tài khoản nhận và số tiền khớp. Trạng thái nhận đơn vẫn do cửa hàng xử lý.
- Đơn chuyển khoản lưu mã nội dung ngắn cùng ảnh chụp thông tin ngân hàng tại thời điểm đặt để việc đổi tài khoản sau này không làm đổi QR của đơn cũ.
- `payment_status` tách biệt với tiến độ món: đơn QR mới ở trạng thái `awaiting_payment`; chủ cửa hàng xác nhận thủ công sau khi kiểm tra biến động số dư, chuyển sang `paid`.
- QR được tạo trực tiếp trong trình duyệt bằng dữ liệu đơn hàng. Hệ thống MVP chưa tự đối soát giao dịch hoặc tự hoàn tiền.

## Mã khuyến mãi

- Mỗi mã thuộc về một cửa hàng; mã được chuẩn hóa chữ in hoa và duy nhất trong cửa hàng đó.
- Có thể giảm theo phần trăm hoặc số tiền, yêu cầu đơn tối thiểu, ngày bắt đầu/kết thúc và giới hạn lượt sử dụng.
- Khách xem trước mức giảm bằng RPC công khai, nhưng RPC tạo đơn khóa dòng mã và kiểm tra lại tất cả điều kiện cùng lúc với việc ghi mức giảm vào đơn và tăng lượt dùng.
- Mức giảm chỉ áp dụng lên tiền món, không làm giảm phí giao hàng. Đơn giữ lại mã và số tiền giảm để cửa hàng và khách tra cứu kể cả khi mã được tắt sau đó.

## Chưa thuộc MVP hiện tại

Tích hợp đơn vị giao hàng, định tuyến theo đường phố, tồn kho nhiều chi nhánh và đánh giá cấp cửa hàng có thể bổ sung sau khi luồng đặt hàng cơ bản ổn định.

Khách có thể nhận món tại cửa hàng hoặc chọn cửa hàng tự giao trong bán kính cấu hình. Đơn giao có trạng thái **Đang giao** trước khi hoàn tất. Thanh toán tiền mặt khi nhận hoặc chuyển khoản QR vào tài khoản riêng của cửa hàng. Đánh giá được tạo bởi API máy chủ sau khi xác nhận đơn đã hoàn tất; không mở quyền ghi trực tiếp cho trình duyệt.
