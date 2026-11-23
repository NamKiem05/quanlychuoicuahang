# GrowDesk --- Project Context

> Tài liệu bàn giao ngữ cảnh dự án cho ChatGPT, Codex và AI coding
> agents. Cập nhật: 20/11/2026\
> Mục tiêu: giúp AI hiểu kiến trúc, nghiệp vụ, các quyết định đã thảo
> luận và công việc đang triển khai mà không tự suy diễn những phần chưa
> được xác nhận.

------------------------------------------------------------------------

## 1. Tổng quan dự án

**GrowDesk** là nền tảng SaaS multi-tenant cho phép nhiều cửa hàng tạo
và vận hành website bán hàng riêng.

Các loại hình kinh doanh đã được xác định cần hỗ trợ: - **Bán lẻ:** quản
lý sản phẩm, danh mục, biến thể/SKU, tồn kho và đơn hàng. - **Quán ăn:**
quản lý thực đơn/món ăn, tùy chọn món và đơn hàng.

Mỗi cửa hàng có website riêng, khu vực quản trị riêng và cấu hình vận
hành riêng. Nền tảng có khu vực **Super Admin** để quản lý toàn hệ
thống.

### Mục tiêu sản phẩm

1.  Admin GrowDesk quản lý nền tảng, cửa hàng, cấu hình và các tích hợp
    dùng chung.
2.  Chủ shop quản lý hoạt động kinh doanh của cửa hàng.
3.  Khách mua hàng truy cập website cửa hàng, xem hàng/thực đơn và đặt
    hàng.
4.  Hệ thống cô lập dữ liệu giữa các cửa hàng.

------------------------------------------------------------------------

## 2. Công nghệ và môi trường

### Đã được người dùng xác nhận

-   Frontend / ứng dụng: **Next.js**.
-   Database: **Supabase**.
-   Source code tồn tại ở máy local và GitHub.
-   Dự án sử dụng tên miền **growdesk.vn**.
-   Người dùng đang phát triển và cần hướng dẫn triển khai production
    theo từng bước.

### Kiến trúc đã được đề xuất trong các trao đổi

-   Next.js cho giao diện Admin, giao diện quản trị shop, storefront và
    các API route cần thiết.
-   Supabase PostgreSQL làm database.
-   Supabase Auth cho xác thực.
-   Supabase Storage cho tệp/hình ảnh.
-   Có thể sử dụng Next.js Route Handlers hoặc Edge Functions cho các
    tác vụ backend phù hợp.
-   GitHub quản lý source code.
-   Vercel là phương án hosting Next.js đã được đề xuất; chưa ghi nhận
    xác nhận triển khai production hoàn tất.

### Nguyên tắc bắt buộc

-   Không giả định cấu trúc thư mục, phiên bản package hoặc thư viện UI
    khi chưa kiểm tra repository.
-   Trước khi sửa code, đọc `package.json`, cấu trúc `src/app` hoặc
    `app`, cấu hình Supabase và các component/layout hiện tại.
-   Không tự ý thay thế Admin layout, sidebar, authentication hoặc
    conventions hiện có.
-   Không đưa secret vào Git, code client, `localStorage` hoặc log trình
    duyệt.
-   Mọi thay đổi cần giữ tương thích với code hiện có.

------------------------------------------------------------------------

## 3. Multi-tenant và phân quyền

### Nguyên tắc nghiệp vụ

-   Một nền tảng có nhiều cửa hàng.
-   Dữ liệu phát sinh thuộc một cửa hàng phải được gắn định danh cửa
    hàng (thường là `store_id`).
-   Người dùng chỉ được truy cập dữ liệu của cửa hàng mà họ có quyền.
-   Super Admin có phạm vi quản trị toàn nền tảng; chủ shop và nhân viên
    chỉ thao tác trong phạm vi cửa hàng được cấp quyền.

### Kiến trúc bảo vệ dữ liệu được đề xuất

-   Supabase Row Level Security (RLS) là lớp bảo vệ database.
-   Backend cũng phải kiểm tra quyền và phạm vi `store_id`; không chỉ
    dựa vào việc ẩn nút trên UI.
-   Không tin `store_id` do client tự gửi nếu chưa xác thực người dùng
    có quyền với cửa hàng đó.
-   Kiểm thử truy cập chéo tenant là tiêu chí bắt buộc trước production.

### RBAC nhân viên --- đề xuất, chưa xác nhận đã triển khai

Các bảng từng được đề xuất: - `users` - `stores` - `store_users` -
`roles` - `permissions` - `role_permissions` - `store_user_roles` -
`store_invitations` - `activity_logs`

Đề xuất hỗ trợ quyền theo vai trò và quyền thao tác chi tiết, lời mời
nhân viên và nhật ký hoạt động. Đây là phương án kiến trúc đã thảo luận,
không được coi là schema hiện tại nếu chưa kiểm tra Supabase.

### Các điểm còn mở

-   Tài khoản khách hàng là tài khoản riêng theo từng shop hay tài khoản
    dùng chung toàn nền tảng: **chưa chốt**.
-   Có cho phép guest checkout hay không: **chưa chốt**.

------------------------------------------------------------------------

## 4. Loại hình cửa hàng: bán lẻ và quán ăn

GrowDesk cần hỗ trợ cả bán lẻ và quán ăn.

### Quy tắc UI/UX đã thảo luận

-   Không nên hiển thị mọi chức năng quản lý cho mọi loại hình kinh
    doanh.
-   Cửa hàng bán lẻ ưu tiên mục **Quản lý sản phẩm**.
-   Quán ăn ưu tiên mục **Quản lý thực đơn**.
-   Các trang storefront cũng cần cách trình bày khác nhau tùy loại hình
    kinh doanh.
-   Khi Admin thêm theme, cần phân loại theme phù hợp với loại hình kinh
    doanh (ví dụ theme quán ăn và theme bán lẻ).

### Nguyên tắc thiết kế

-   Dùng business type/store type để điều khiển navigation, màn hình và
    trải nghiệm.
-   Có thể tái sử dụng component chung ở những phần thực sự giống nhau,
    nhưng không ép sản phẩm bán lẻ và món ăn vào cùng một UI nếu nghiệp
    vụ khác nhau.
-   Backend/database cần mô hình hóa các khác biệt cần thiết; không chỉ
    ẩn/hiện menu ở frontend.

### Chưa xác nhận

-   Tên enum/giá trị chính thức cho loại hình kinh doanh.
-   Schema sản phẩm, biến thể, món ăn, modifier/topping và tồn kho hiện
    tại.
-   Cơ chế theme và cấu trúc bảng theme hiện tại.

------------------------------------------------------------------------

## 5. Tạo cửa hàng và quản lý website

GrowDesk có luồng tạo cửa hàng và cấu hình website riêng. Chi tiết đầy
đủ của quy trình tạo shop cần được đối chiếu với source code hiện tại
trước khi triển khai.

### Tên miền riêng (custom domain)

Nghiệp vụ đã thảo luận: - Khách hàng/chủ shop có thể muốn dùng tên miền
riêng cho website cửa hàng. - Mua tên miền và cấu hình tên miền là hai
việc khác nhau. - Người dùng thường phải mua/sở hữu tên miền trước;
GrowDesk hướng dẫn họ cấu hình DNS. - Có thể tự động hóa phần lớn quá
trình kiểm tra DNS và kích hoạt, nhưng chủ tên miền vẫn cần thực hiện
thao tác DNS ban đầu tại nhà cung cấp tên miền.

### Quy trình trạng thái được đề xuất

`pending_verification` → `verified` → `pending_ssl` → `active`

Bảng được đề xuất: `store_domains` (chưa xác nhận đã tạo). Các bước: 1.
Chủ shop nhập domain. 2. GrowDesk cung cấp bản ghi TXT để xác minh quyền
sở hữu. 3. Chủ shop cấu hình TXT tại nhà cung cấp DNS. 4. GrowDesk kiểm
tra TXT. 5. Hướng dẫn cấu hình CNAME/A record trỏ về hạ tầng hosting. 6.
Hệ thống kiểm tra DNS và thiết lập SSL. 7. Domain chuyển sang active. 8.
Next.js phân giải hostname thành `store_id` để hiển thị đúng storefront.

### Yêu cầu kỹ thuật

-   Không tin hostname do client tự khai báo; cần tra cứu domain đã xác
    minh/active trong hệ thống.
-   Đảm bảo hostname ánh xạ đúng một cửa hàng.
-   Chống truy cập chéo dữ liệu tenant.
-   Có trạng thái lỗi, hướng dẫn DNS và nút kiểm tra lại.
-   Chi tiết record DNS phụ thuộc hosting thực tế; không hard-code khi
    chưa xác nhận cấu hình triển khai.

------------------------------------------------------------------------

## 6. Vận chuyển và tích hợp GHN

Đây là một module nghiệp vụ trọng tâm đang được thảo luận.

### 6.1. Phân biệt khái niệm

Không đồng nhất **đơn vị vận chuyển** với **phương thức giao hàng**.

-   Đơn vị vận chuyển: GHN hoặc nhà cung cấp logistics khác.
-   Phương thức giao hàng: giao qua đối tác, shop tự giao, khách đến cửa
    hàng lấy hàng.

Ba phương thức GrowDesk cần hỗ trợ: 1. **Giao hàng qua đối tác:** ví dụ
GHN. 2. **Shop tự giao hàng:** shop tự tổ chức người giao và cập nhật
trạng thái. 3. **Khách đến lấy hàng:** không tạo vận đơn GHN, khách nhận
tại địa chỉ cửa hàng.

### 6.2. Phân cấp cấu hình

**Super Admin GrowDesk** - Quản lý danh sách đối tác được nền tảng hỗ
trợ. - Quản lý trạng thái tích hợp toàn nền tảng. - Quản lý endpoint/môi
trường và cấu hình tích hợp trung tâm nếu có. - Quản lý webhook
endpoint, giám sát và nhật ký. - Quy định phương thức nào được phép sử
dụng trên nền tảng. - Quản lý chính sách và giới hạn cấp nền tảng.

**Chủ shop** - Chọn phương thức nào được bật cho cửa hàng trong phạm vi
nền tảng cho phép. - Cấu hình địa chỉ lấy hàng. - Kết nối tài khoản GHN
riêng (nếu mô hình tích hợp yêu cầu tài khoản riêng). - Cấu hình giao
hàng riêng và địa chỉ nhận hàng. - Cấu hình bao bì/đóng gói và thông tin
kiện hàng. - Theo dõi và xử lý đơn/vận đơn của shop.

**Khách mua hàng** - Chọn phương thức giao hàng mà shop đã bật. -
Nhập/chọn địa chỉ nhận hàng nếu giao tận nơi. - Xem phí giao hàng và
thông tin nhận hàng trước khi xác nhận đơn.

### 6.3. Cấu hình GHN

Các thông tin kỹ thuật đã được thảo luận: - Token. - Shop ID. - API
endpoint. - Môi trường Staging/Test và Production. - Webhook nhận cập
nhật trạng thái đơn giao hàng.

Phải tách bạch: - Tài khoản/tích hợp GHN trung tâm của GrowDesk (nếu
có). - Credential và Shop ID của từng cửa hàng.

Không dùng chung credential của một shop cho shop khác. Credential phải
được lưu ở backend/database an toàn, mã hóa phù hợp và không trả token
đầy đủ về client.

### 6.4. Test và Production

Người dùng đã cân nhắc dùng GHN mô phỏng hay thật; chưa có xác nhận cuối
cùng về lựa chọn môi trường production.

Phương án đã được đề xuất: - Phát triển và kiểm thử logic với
Staging/simulation trước. - Thiết kế để mỗi shop hoặc cấu hình kết nối
có mode `simulation`/`production`. - Dùng chung nghiệp vụ nội bộ để
không phải viết lại luồng đơn hàng khi đổi môi trường. - Chỉ cho phép
production sau khi cấu hình và kiểm tra thông tin kết nối hợp lệ.

Lưu ý: - Có thể gọi API tạo vận đơn thật từ môi trường local nếu có
credential và mạng phù hợp. - Webhook để GHN gọi ngược về ứng dụng cần
endpoint public HTTPS. - Không khẳng định GHN sẽ đến lấy hàng chỉ vì
đang chạy localhost; cần phân biệt tạo vận đơn thật và việc GHN nhận
được webhook trạng thái.

### 6.5. Webhook GHN

Endpoint đã được thảo luận: `POST /api/webhooks/ghn`

Tên miền test đã được nhắc: `https://test.growdesk.vn/api/webhooks/ghn`

Tình trạng được ghi nhận ngày 19/11/2026: - URL
`growdesk.vn/api/webhooks/ghn` từng trả về 404. - Webhook test cần bản
deploy public HTTPS, kết nối với Supabase TEST. - Cần cấu hình
`GHN_WEBHOOK_SECRET`. - GHN Order có trường/sự kiện `switch_status` được
nhắc trong quá trình xử lý. - Có hai mã vận đơn thử nghiệm hiện có cần
được tái sử dụng khi kiểm thử. - Việc triển khai webhook production/test
vẫn chưa được xác nhận hoàn tất.

Luồng backend đã đề xuất: 1. GHN gửi HTTP POST tới endpoint. 2. Backend
xác thực secret/chữ ký theo cơ chế GHN thực tế hỗ trợ. 3. Kiểm tra
payload và mã vận đơn. 4. Tìm shipment/waybill tương ứng trong Supabase.
5. Ghi nhận sự kiện và cập nhật trạng thái vận chuyển. 6. Đảm bảo xử lý
idempotent để webhook gửi lặp không gây cập nhật sai hoặc xử lý trùng.
7. Trả HTTP response phù hợp. 8. Ghi log an toàn, không ghi
token/secret.

Phải xác minh lại tên header, cơ chế xác thực và schema payload theo tài
liệu GHN hiện hành trước khi code. Không tự giả định
`GHN_WEBHOOK_SECRET` là cơ chế xác thực chính thức nếu chưa đối chiếu
tài liệu; đây là tên biến cấu hình đã được nhắc trong kế hoạch test.

### 6.6. Phí vận chuyển, sản phẩm và đóng gói

GrowDesk hỗ trợ cả bán lẻ và quán ăn, vì vậy không nên dùng một mô hình
tính phí duy nhất cho mọi loại hình.

Đề xuất đã thảo luận cho bán lẻ: - Shipping profile trên sản phẩm/biến
thể: trọng lượng (gram), kích thước (cm). - Cấu hình bao bì của shop. -
Khi đặt hàng, tính toán và phân bổ sản phẩm vào một hoặc nhiều kiện. -
Lưu snapshot thông tin kiện tại thời điểm tạo vận đơn để đảm bảo lịch sử
không bị thay đổi nếu shop sửa sản phẩm/bao bì sau này.

Các tình huống cần xử lý: - Nhiều sản phẩm trong một đơn. - Tổng hàng
vượt sức chứa của một bao bì. - Shop không cấu hình bao bì. - Cần tách
đơn thành nhiều kiện. - Tính phí theo dữ liệu kiện thực tế và dịch vụ
GHN phù hợp.

Đề xuất cho quán ăn: - Không mặc định dùng quy trình đóng gói GHN như
bán lẻ. - Có thể dùng phí theo khu vực/khoảng cách và thời gian chuẩn
bị. - Cần xác định đối tác giao hàng có hỗ trợ loại hình giao đồ ăn hay
không trước khi tích hợp.

Đây là thiết kế nghiệp vụ đề xuất, chưa xác nhận schema/database đã
triển khai.

### 6.7. Quy trình xử lý đơn của shop

Luồng đã được đề xuất: 1. Tiếp nhận đơn. 2. Chủ shop xác nhận hoặc từ
chối. 3. Chuẩn bị hàng/món. 4. Đóng gói và chia kiện nếu cần. 5. Tạo vận
đơn GHN nếu khách chọn giao qua GHN. 6. Bàn giao cho đơn vị vận chuyển.
7. Theo dõi trạng thái qua webhook/API. 8. Hoàn tất, xử lý COD hoặc hoàn
hàng theo tình huống.

Phải tách riêng các nhóm trạng thái: - `order_status`: trạng thái xử lý
đơn hàng của shop. - `payment_status`: trạng thái thanh toán. -
`shipping_status`: trạng thái vận chuyển.

Không dùng một cột trạng thái duy nhất để biểu diễn tất cả các nghiệp
vụ.

Các trạng thái cụ thể cần được thống nhất với schema và tài liệu GHN
trước khi code.

------------------------------------------------------------------------

## 7. Quản lý đơn hàng

Luồng nghiệp vụ chủ shop đã được thảo luận: - Shop tiếp nhận đơn mới
đang chờ xác nhận. - Chủ shop có thao tác xác nhận hoặc từ chối. - Sau
khi xác nhận, shop chuẩn bị hàng. - Tùy phương thức giao hàng, shop tạo
vận đơn, tự giao hoặc chuẩn bị hàng để khách đến lấy. - Trạng thái giao
hàng được cập nhật độc lập với trạng thái xử lý đơn.

Khi chủ shop nhấn **Xác nhận đơn hàng**, backend cần: 1. Xác thực người
dùng và quyền quản lý shop. 2. Kiểm tra đơn thuộc đúng `store_id`. 3.
Kiểm tra đơn đang ở trạng thái có thể xác nhận. 4. Kiểm tra dữ liệu và
các điều kiện nghiệp vụ cần thiết. 5. Cập nhật order status một cách an
toàn. 6. Ghi lịch sử thay đổi. 7. Trả kết quả để UI cập nhật.

Không tự động tạo vận đơn GHN ngay khi xác nhận đơn nếu nghiệp vụ yêu
cầu shop chuẩn bị và đóng gói trước. Thời điểm tạo vận đơn cần gắn với
bước xử lý vận chuyển thích hợp.

------------------------------------------------------------------------

## 8. Giao diện Super Admin --- module vận chuyển đang triển khai

### Trạng thái công việc hiện tại

Ngày 20/11/2026, người dùng yêu cầu hướng dẫn xây dựng **UI quản lý vận
chuyển ở phạm vi Admin**, hỗ trợ cả ba phương thức, bắt đầu từ giao
diện.

Phạm vi hiện tại là **Super Admin**, không phải trang cấu hình vận
chuyển của chủ shop.

### Menu Admin được đề xuất

`Quản lý vận chuyển` - Tổng quan vận chuyển - Đơn vị vận chuyển - Phương
thức giao hàng - Cấu hình hệ thống - Chính sách vận chuyển

### Các màn hình được đề xuất

#### A. Tổng quan --- `/admin/shipping`

-   4 thẻ thống kê:
    -   Tổng số đơn vị vận chuyển.
    -   Số đối tác đang hoạt động.
    -   Tổng phương thức được hỗ trợ.
    -   Số cửa hàng đang sử dụng.
-   Danh sách đơn vị vận chuyển.
-   Biểu đồ cửa hàng sử dụng từng đối tác/phương thức.
-   Thống kê vận đơn nếu có dữ liệu thực tế.

#### B. Đơn vị vận chuyển --- `/admin/shipping/providers`

-   Danh sách đối tác.
-   Logo, tên, mô tả.
-   Trạng thái tích hợp.
-   Môi trường.
-   Số shop sử dụng.
-   Nút cấu hình.

#### C. Chi tiết GHN --- `/admin/shipping/providers/ghn`

Bốn tab được đề xuất: 1. Kết nối API. 2. Webhook. 3. Cấu hình chung. 4.
Nhật ký hoạt động.

Tab Kết nối API: - Môi trường Staging/Production. - Endpoint. - Token
(hiển thị dạng che). - Shop ID nếu cấu hình tích hợp trung tâm có trường
này. - Nút kiểm tra kết nối.

Tab Webhook: - Endpoint URL. - Trạng thái. - Sao chép URL. - Kiểm tra
endpoint. - Lần nhận webhook gần nhất. - Nhật ký webhook thành công/thất
bại.

Tab Cấu hình chung: - Cho phép shop mới kết nối. - Cho phép môi trường
test. - Điều kiện chuyển production. - Tạm dừng kết nối mới.

Tab Nhật ký: - Thời gian. - Hành động. - Kết quả. - Chi tiết lỗi an
toàn.

#### D. Phương thức giao hàng --- `/admin/shipping/methods`

Ba phương thức: - Giao hàng qua đối tác. - Shop tự giao hàng. - Khách
đến lấy hàng.

Admin bật/tắt khả năng hỗ trợ ở cấp nền tảng. Shop mới là bên chọn
phương thức được sử dụng cho cửa hàng, theo chính sách cho phép.

Các route chi tiết được đề xuất: -
`/admin/shipping/methods/self-delivery` -
`/admin/shipping/methods/pickup`

#### E. Cấu hình hệ thống --- `/admin/shipping/settings`

-   Quyền sử dụng.
-   Cấu hình mặc định.
-   Giới hạn.
-   Bảo mật.

#### F. Chính sách --- `/admin/shipping/policies`

-   Danh sách chính sách.
-   Thêm/sửa/xem.
-   Trạng thái áp dụng.
-   Lịch sử thay đổi.

### Nguyên tắc UI

-   Giao diện Admin xanh dương/trắng.
-   Phải kế thừa Admin layout/sidebar hiện tại.
-   Responsive desktop/tablet/mobile.
-   Có loading, empty state, error state.
-   Có confirmation modal cho hành động bật/tắt hoặc thay đổi quan
    trọng.
-   Có toast.
-   Có breadcrumb.
-   Tách page, component, types, mock data và constants.
-   Không tạo dữ liệu mock rải rác trong component.
-   Chưa tích hợp API thật trong giai đoạn UI.

### Cấu trúc thư mục gợi ý (chỉ là đề xuất)

``` text
src/
  app/
    admin/
      shipping/
        page.tsx
        providers/
          page.tsx
          [providerId]/
            page.tsx
        methods/
          page.tsx
          [methodId]/
            page.tsx
        settings/
          page.tsx
        policies/
          page.tsx
  components/
    admin/
      shipping/
        ShippingStats.tsx
        ProviderCard.tsx
        ProviderTable.tsx
        ProviderStatus.tsx
        ShippingMethodCard.tsx
        ShippingConfigForm.tsx
        WebhookConfig.tsx
        ShippingActivityLog.tsx
  types/
    shipping.ts
  lib/
    shipping/
      constants.ts
      mock-data.ts
```

Không bắt buộc dùng chính xác cấu trúc này nếu repository hiện tại có
convention khác.

------------------------------------------------------------------------

## 9. Kế hoạch triển khai tổng thể

Thứ tự đã được đề xuất:

1.  Hoàn thiện UI Super Admin vận chuyển.
2.  Đối chiếu và thiết kế schema Supabase.
3.  Xây dựng backend quản lý đơn vị vận chuyển/phương thức/chính sách.
4.  Tích hợp GHN Staging và kiểm thử.
5.  Xây dựng cấu hình vận chuyển cấp shop.
6.  Xây dựng tính phí và quy trình đóng gói/kiện hàng.
7.  Kết nối checkout storefront.
8.  Hoàn thiện tạo vận đơn, webhook và theo dõi trạng thái.
9.  Kiểm thử tenant isolation, bảo mật và luồng end-to-end.
10. Chuẩn bị production.

### Triển khai production đã thảo luận

-   Source code → GitHub.
-   Next.js hosting → Vercel (phương án đề xuất).
-   Supabase production riêng, cấu hình Auth/Storage/RLS.
-   Domain và DNS.
-   HTTPS.
-   Kiểm thử đăng nhập, phân quyền, thanh toán, tenant isolation và
    webhook.

Tình trạng được ghi nhận: webhook test cần deploy public HTTPS và
Supabase TEST; chưa xác nhận hoàn tất.

------------------------------------------------------------------------

## 10. Những điều AI/Codex phải tuân thủ

1.  **Đọc repository trước khi sửa code.** Không giả định cấu trúc file.
2.  **Không bịa schema.** Kiểm tra Supabase migrations/schema hiện tại
    trước khi viết query hoặc migration.
3.  **Không tự tạo breaking changes.** Không đổi Admin layout, auth,
    route conventions hoặc UI framework khi chưa có lý do và chưa được
    chấp thuận.
4.  **Multi-tenant là yêu cầu cốt lõi.** Mọi dữ liệu của shop phải được
    kiểm tra theo tenant ở backend và RLS.
5.  **Tách trạng thái đơn, thanh toán và vận chuyển.**
6.  **Tách credential GHN trung tâm và credential GHN của từng shop.**
7.  **Không lộ secret.** Không đưa token/secret vào client bundle,
    localStorage, Git hoặc log.
8.  **Webhook phải idempotent.** Ghi nhận sự kiện và tránh xử lý lặp gây
    sai trạng thái.
9.  **Không tự động tạo vận đơn ở bước xác nhận đơn** nếu chưa đến bước
    chuẩn bị/đóng gói phù hợp.
10. **Phân biệt confirmed và proposed.** Những gì ghi là "đề xuất" không
    được coi là đã triển khai hoặc quyết định cuối cùng.
11. **Làm theo từng bước nhỏ.** Sau mỗi giai đoạn, báo cáo file thay
    đổi, cách kiểm thử, kết quả và việc còn lại.
12. **Không dùng dữ liệu production để thử nghiệm** khi chưa có xác nhận
    rõ ràng.

------------------------------------------------------------------------

## 11. Các câu hỏi còn cần xác minh

-   Cấu trúc repository và phiên bản Next.js hiện tại.
-   UI component library và quy ước styling đang dùng.
-   Schema Supabase thực tế và các migration đã chạy.
-   Mô hình tài khoản khách hàng: theo từng shop hay dùng chung nền
    tảng.
-   Có hỗ trợ guest checkout không.
-   Quy trình tạo shop chính xác và trạng thái shop hiện tại.
-   Mô hình credential GHN: tài khoản trung tâm, tài khoản riêng từng
    shop hay kết hợp.
-   Đã chọn chính thức GHN Staging hay Production cho giai đoạn hiện tại
    chưa.
-   Schema và cơ chế xác thực webhook chính thức theo tài liệu GHN.
-   Quy tắc chia kiện/bao bì và xử lý shop không cấu hình bao bì.
-   Phí giao hàng cho quán ăn.
-   Trạng thái đơn hàng, thanh toán và vận chuyển chính thức.
-   Cấu hình hosting/domain production thực tế.

------------------------------------------------------------------------

## 12. Công việc tiếp theo ngay lúc này

**Task hiện tại: UI Super Admin --- Tổng quan vận chuyển.**

Yêu cầu Codex: 1. Đọc repository và xác định Admin layout/sidebar hiện
tại. 2. Kiểm tra package, UI library, icon library và chart library đã
cài. 3. Đề xuất các file cần tạo/sửa, không sửa ngay các phần không liên
quan. 4. Tạo route `/admin/shipping`. 5. Dựng UI tổng quan với mock data
tập trung. 6. Giữ nguyên layout và authentication hiện tại. 7. Chạy
lint/typecheck/build theo scripts có sẵn. 8. Báo cáo kết quả và chờ xác
nhận trước khi triển khai màn hình tiếp theo.

**Prompt ngắn cho Codex:**

> Đọc `PROJECT_CONTEXT.md` trước khi làm việc. Hiện tại chỉ triển khai
> Task 12: UI trang Tổng quan vận chuyển tại `/admin/shipping` cho Super
> Admin. Trước tiên kiểm tra cấu trúc repository, Admin layout, UI
> conventions và scripts hiện có. Không sửa database, không viết
> backend/API, không tích hợp GHN thật và không thay đổi các module
> khác. Dùng mock data tập trung, TypeScript nghiêm ngặt, responsive UI.
> Sau khi hoàn thành, chạy các kiểm tra phù hợp và báo cáo danh sách
> file thay đổi, kết quả kiểm tra và các vấn đề còn lại.
