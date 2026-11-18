"use client";
import { useActionState } from "react";
import { checkPaymentConfiguration, savePaymentSettings } from "./actions";

export default function PaymentForm({ enabled, bankLabel, webhookUrl, webhookReady }: { enabled: boolean; bankLabel: string; webhookUrl: string | null; webhookReady: boolean }) {
  const [result, action, pending] = useActionState(savePaymentSettings, null);
  const [test, testAction, testing] = useActionState(checkPaymentConfiguration, null);
  return <section className="platform-settings-card platform-settings-payment"><div className="platform-settings-card-title"><span>03</span><div><h2>Cấu hình thanh toán</h2><p>Thanh toán gói dịch vụ của GrowDesk qua chuyển khoản ngân hàng và SePay.</p></div></div>
    <form className="platform-settings-form" action={action}><label className="payment-setting-switch"><input type="checkbox" name="sepay_enabled" defaultChecked={enabled} /><span><b>Chuyển khoản QR · SePay</b><small>Bật hoặc tắt tạo yêu cầu thanh toán mới. Các giao dịch đang chờ vẫn được đối soát.</small></span></label>
      <div className="payment-setting-details"><div><span>Tài khoản nhận</span><b>{bankLabel}</b></div><div><span>Khóa webhook</span><b>{webhookReady ? "Đã cấu hình" : "Chưa cấu hình"}</b></div><div><span>Webhook SePay</span><code>{webhookUrl ?? "Chưa cấu hình NEXT_PUBLIC_APP_URL"}</code></div></div>
      <p className="platform-settings-note">Cấu hình ngân hàng bằng MERCHANT_PLAN_BANK_CODE, MERCHANT_PLAN_ACCOUNT_NUMBER và MERCHANT_PLAN_ACCOUNT_NAME; cấu hình khóa webhook bằng MERCHANT_PLAN_SEPAY_API_KEY trên máy chủ. Sao chép URL webhook vào SePay và dùng cùng khóa. Thay đổi biến môi trường cần khởi động lại ứng dụng.</p>
      {result?.error && <p className="platform-settings-error" role="alert">{result.error}</p>}{result?.success && <p className="platform-settings-success" role="status">{result.success}</p>}<div className="platform-settings-footer"><button type="submit" disabled={pending}>{pending ? "Đang lưu…" : "Lưu cấu hình thanh toán"}</button></div></form>
    <form className="platform-settings-subsection" action={testAction}><h3>Kiểm tra cấu hình</h3><p className="smtp-test-description">Kiểm tra cấu hình nội bộ; thao tác này không tạo giao dịch hoặc kiểm tra kết nối thực tế tới SePay.</p>{test?.error && <p className="platform-settings-error" role="alert">{test.error}</p>}{test?.success && <p className="platform-settings-success" role="status">{test.success}</p>}<div className="platform-settings-footer"><button type="submit" disabled={testing}>{testing ? "Đang kiểm tra…" : "Kiểm tra cấu hình"}</button></div></form>
  </section>;
}
