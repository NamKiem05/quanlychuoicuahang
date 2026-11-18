import Link from "next/link";

type Props = { publicBaseUrl: string | null; sepayConfigured: boolean; smtpConfigured: boolean | null; storageAvailable: boolean; };
export default function IntegrationsPanel({ publicBaseUrl, sepayConfigured, smtpConfigured, storageAvailable }: Props) {
  const planWebhook = publicBaseUrl ? new URL("/api/webhooks/sepay-merchant-plan", publicBaseUrl).toString() : null;
  const storeWebhook = publicBaseUrl ? new URL("/api/webhooks/sepay", publicBaseUrl).toString() : null;
  return <section className="platform-settings-card platform-settings-integrations"><div className="platform-settings-card-title"><span>08</span><div><h2>Cấu hình tích hợp</h2><p>Các dịch vụ và webhook đã được kết nối trong GrowDesk.</p></div></div>
    <div className="integration-list"><article><div><h3>SePay · thanh toán gói dịch vụ</h3><p>Nhận webhook chuyển khoản cho gói dịch vụ. Tài khoản ngân hàng và khóa được cấu hình ở box thanh toán.</p></div><span className="integration-status">{sepayConfigured ? "Đã có cấu hình khóa" : "Chưa cấu hình khóa"}</span></article>
      <article><div><h3>SePay · đơn hàng cửa hàng</h3><p>Mỗi cửa hàng tự tạo khóa webhook tại Cấu hình cửa hàng → Thanh toán QR.</p></div><span className="integration-status">Tùy từng cửa hàng</span></article>
      <article><div><h3>Email SMTP</h3><p>Dùng gửi email đơn hàng; cài đặt và gửi thử tại box cấu hình email.</p></div><span className="integration-status">{smtpConfigured === null ? "Chưa kiểm tra được" : smtpConfigured ? "Đã lưu cấu hình" : "Chưa lưu cấu hình"}</span></article>
      <article><div><h3>Supabase Storage</h3><p>Lưu ảnh và tệp; thông tin bucket được hiển thị trong box lưu trữ và sao lưu.</p></div><span className="integration-status">{storageAvailable ? "Đã tải danh sách bucket" : "Chưa tải được bucket"}</span></article>
      <article><div><h3>Bản đồ</h3><p>Dùng tile bản đồ để chọn vị trí cửa hàng. URL tile được cấu hình qua biến NEXT_PUBLIC_MAP_TILE_URL khi triển khai.</p></div><span className="integration-status">Đã tích hợp</span></article>
    </div>
    <div className="platform-settings-subsection"><h3>Webhook tiếp nhận</h3><div className="payment-setting-details"><div><span>Thanh toán gói dịch vụ</span><code>{planWebhook ?? "Chưa cấu hình NEXT_PUBLIC_APP_URL"}</code></div><div><span>Thanh toán đơn hàng</span><code>{storeWebhook ?? "Chưa cấu hình NEXT_PUBLIC_APP_URL"}</code></div></div><p className="security-setting-help integration-webhook-note">Cần URL HTTPS công khai để nhà cung cấp gọi webhook. Địa chỉ localhost chỉ dùng để phát triển và không nhận được webhook từ Internet.</p></div>
    <div className="platform-settings-subsection"><h3>Dịch vụ chưa tích hợp</h3><div className="security-setting-list"><div><span>Dịch vụ AI</span><b>Chưa tích hợp</b></div><div><span>Dịch vụ SMS</span><b>Chưa tích hợp</b></div><div><span>API bên thứ ba và webhook tùy chỉnh</span><b>Chưa tích hợp</b></div></div><p className="security-setting-help">Trạng thái trên chỉ phản ánh cấu hình hoặc dữ liệu đọc được, không xác nhận nhà cung cấp đang kết nối. Xem thêm tại <Link href="/admin/monitoring">Giám sát hệ thống</Link>.</p></div>
  </section>;
}
