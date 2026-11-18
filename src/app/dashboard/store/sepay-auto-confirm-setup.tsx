"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSePayWebhookKey } from "../actions";

export default function SePayAutoConfirmSetup({
  hasKey: initialHasKey,
  enabled: initialEnabled,
  qrEnabled,
  storeId,
}: {
  hasKey: boolean;
  enabled: boolean;
  qrEnabled: boolean;
  storeId: string;
}) {
  const router = useRouter();
  const [hasKey, setHasKey] = useState(initialHasKey);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [secret, setSecret] = useState("");
  const [notice, setNotice] = useState("");
  const [isPending, startTransition] = useTransition();
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    // The origin is only available in the browser after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);
  useEffect(() => {
    // Refresh server-provided connection status after router.refresh().
    /* eslint-disable react-hooks/set-state-in-effect */
    setHasKey(initialHasKey);
    setEnabled(initialEnabled);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [initialEnabled, initialHasKey]);
  const webhookUrl = origin ? `${origin}/api/webhooks/sepay` : "";

  function createKey() {
    setNotice("");
    startTransition(async () => {
      const result = await createSePayWebhookKey(storeId);
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      setSecret(result.secret);
      setHasKey(true);
      setEnabled(false);
      setNotice("Đã tạo khóa mới. Hãy cập nhật khóa này trong SePay; kết nối sẽ tự bật khi webhook gửi tới.");
    });
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`Đã sao chép ${label}.`);
    } catch {
      setNotice("Không sao chép tự động được. Hãy chọn và sao chép nội dung hiển thị.");
    }
  }

  return (
    <div className="sepay-setup">
      <div className="sepay-setup-heading">
        <div>
          <b>Tự xác nhận khi nhận được tiền</b>
          <p>{enabled ? "Đã nhận webhook từ SePay. Hệ thống tự xác nhận khi đúng tài khoản, mã đơn và số tiền." : "Sau khi nhận webhook hợp lệ từ SePay, kết nối sẽ tự bật; hệ thống chỉ xác nhận khi đúng tài khoản, mã đơn và số tiền."}</p>
        </div>
        <span className={`sepay-setup-status${enabled ? " is-enabled" : ""}`}>
          {enabled ? "Đang bật" : hasKey ? "Chờ webhook" : "Chưa kết nối"}
        </span>
      </div>

      {!qrEnabled && <p className="sepay-setup-note">Hãy bật và lưu thanh toán QR trước khi kết nối SePay.</p>}

      <ol className="sepay-setup-steps">
        <li>Liên kết tài khoản ngân hàng của cửa hàng trong SePay.</li>
        <li>Tạo webhook nhận giao dịch <b>tiền vào</b>, chọn đúng tài khoản ngân hàng và định dạng JSON.</li>
        <li>Chọn xác thực <b>API Key</b>, dán URL và khóa bên dưới vào cấu hình webhook của SePay.</li>
        <li>Dùng nút “Gửi thử” trong SePay. Khi webhook tới thành công, kết nối tự chuyển sang đang bật; tải lại trạng thái bên dưới để xem.</li>
      </ol>

      <div className="sepay-setup-field">
        <label htmlFor="sepay-webhook-url">URL nhận giao dịch</label>
        <div><code id="sepay-webhook-url">{webhookUrl || "Đang lấy địa chỉ website…"}</code><button type="button" disabled={!webhookUrl} onClick={() => void copy(webhookUrl, "URL webhook")}>Sao chép URL</button></div>
      </div>

      {secret ? (
        <div className="sepay-setup-field">
          <label htmlFor="sepay-webhook-secret">API Key · chỉ hiển thị sau khi tạo</label>
          <div><code id="sepay-webhook-secret">{secret}</code><button type="button" onClick={() => void copy(secret, "API Key")}>Sao chép khóa</button></div>
        </div>
      ) : hasKey ? (
        <p className="sepay-setup-note">Khóa đã được tạo và không lưu dạng đọc được. Nếu chưa sao chép, hãy tạo khóa mới rồi cập nhật API Key trong SePay. Sau khi SePay gửi webhook, kết nối sẽ tự bật.</p>
      ) : null}

      <div className="sepay-setup-actions">
        <button className="secondary-submit" type="button" disabled={!qrEnabled || isPending} onClick={createKey}>
          {isPending ? "Đang xử lý…" : hasKey ? "Tạo lại khóa kết nối" : "Tạo khóa kết nối"}
        </button>
        {hasKey && <button className="sepay-refresh-button" type="button" onClick={() => router.refresh()}>Làm mới trạng thái</button>}
      </div>

      <p className="sepay-setup-note">Webhook cần URL HTTPS công khai. Nếu đang chạy localhost, SePay không thể gọi trực tiếp vào máy bạn; hãy dùng địa chỉ triển khai hoặc tunnel HTTPS khi thử.</p>
      {notice && <p className="sepay-setup-notice" role="status">{notice}</p>}
    </div>
  );
}
