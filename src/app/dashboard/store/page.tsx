import type { Metadata } from "next";
import { banks } from "@viet-qr/core";
import { redirect } from "next/navigation";
import StoreLocationPicker from "./location-picker";
import { updateStoreDeliverySettings, updateStoreOrderAcceptance, updateStorePaymentSettings, updateStoreProfile } from "../actions";
import { dashboardMessages, getMerchantContext } from "../data";

export const metadata: Metadata = { title: "Cửa hàng | Quản lý cửa hàng" };

export default async function MerchantStorePage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const [{ supabase, membership, store }, query] = await Promise.all([getMerchantContext(), searchParams]);
  if (!store || !membership) redirect("/dashboard");
  const [{ data: paymentSettings }, { data: locationCoordinates }] = await Promise.all([
    supabase
      .from("store_payment_methods")
      .select("bank_code, bank_name, account_number, account_name, is_enabled")
      .eq("store_id", store.id)
      .maybeSingle(),
    supabase.rpc("get_store_location_coordinates", { requested_store_id: store.id }).maybeSingle(),
  ]);
  const message = query.message ? dashboardMessages[query.message] : undefined;

  return (
    <main className="admin-content">
      <div className="dashboard-kicker">THIẾT LẬP GIAN HÀNG</div>
      <h1 className="admin-page-title">Cửa hàng</h1>
      <p className="dashboard-intro">Thông tin website và vị trí bán hàng của {store.name}.</p>
      {message && <p className="dashboard-message" role="status">{message}</p>}

      <section className="store-summary-card merchant-summary-card">
        <div>
          <div className="store-summary-label">WEBSITE CỬA HÀNG</div>
          <b>{store.name}</b>
          <span>/{store.slug}</span>
        </div>
        <div className="store-summary-actions">
          <span className={"status-badge status-" + store.status}>{store.status === "active" ? "Đang hoạt động" : store.status === "suspended" ? "Đã tạm dừng" : "Chờ duyệt"}</span>
          {store.status === "active" && <a className="store-preview-link" href={"/" + store.slug}>Xem website ↗</a>}
        </div>
      </section>
      {store.status !== "active" && <p className="dashboard-help approval-note">Gian hàng đang ở trạng thái bản nháp. Admin nền tảng cần duyệt trước khi cửa hàng hiển thị công khai.</p>}

      <section className="dashboard-card merchant-order-status-card">
        <div className="dashboard-card-heading">
          <div><span className="card-number">↗</span><h2>Nhận đơn trực tuyến</h2></div>
          <p>{store.accepts_orders ? "Khách có thể thêm món vào giỏ và đặt hàng." : "Khách vẫn xem được thực đơn nhưng chưa thể đặt hàng."}</p>
        </div>
        <div className="merchant-order-status-row">
          <span className={"status-badge " + (store.accepts_orders ? "status-active" : "status-suspended")}>
            {store.accepts_orders ? "Đang nhận đơn" : "Đang tạm ngưng"}
          </span>
          {membership.role === "owner" ? (
            <form action={updateStoreOrderAcceptance}>
              <input type="hidden" name="accepts_orders" value={store.accepts_orders ? "false" : "true"} />
              <button className={"merchant-order-toggle-button" + (store.accepts_orders ? " is-paused" : "")} type="submit">
                {store.accepts_orders ? "Tạm ngưng nhận đơn" : "Mở nhận đơn trở lại"}
              </button>
            </form>
          ) : (
            <span className="dashboard-help">Chỉ chủ cửa hàng mới có thể thay đổi trạng thái này.</span>
          )}
        </div>
      </section>

      <div className="merchant-store-details">
        <section className="dashboard-card">
          <div className="dashboard-card-heading">
            <div><span className="card-number">01</span><h2>Thông tin cơ bản</h2></div>
            <p>Thông tin hiển thị cho khách hàng.</p>
          </div>
          {membership.role === "owner" ? (
            <form className="dashboard-form merchant-store-form" action={updateStoreProfile}>
              <label>Tên cửa hàng<input name="name" required minLength={2} maxLength={120} defaultValue={store.name} /></label>
              <label>Đường dẫn cửa hàng <span className="field-hint">Chỉ dùng chữ thường, số và dấu gạch ngang</span><input name="slug" required maxLength={80} defaultValue={store.slug} /></label>
              <p className="dashboard-help">Đổi đường dẫn sẽ làm thay đổi địa chỉ website hiện tại: /{store.slug}</p>
              <label>Số điện thoại<input name="phone" type="tel" maxLength={30} defaultValue={store.phone ?? ""} placeholder="090 123 4567" /></label>
              <label>Địa chỉ<input name="address" maxLength={255} defaultValue={store.address ?? ""} placeholder="Địa chỉ cửa hàng" /></label>
              <button className="secondary-submit" type="submit">Lưu thông tin</button>
            </form>
          ) : (
            <dl>
              <div><dt>Tên cửa hàng</dt><dd>{store.name}</dd></div>
              <div><dt>Địa chỉ trang</dt><dd>/{store.slug}</dd></div>
              <div><dt>Số điện thoại</dt><dd>{store.phone || "Chưa thêm"}</dd></div>
              <div><dt>Địa chỉ</dt><dd>{store.address || "Chưa thêm"}</dd></div>
              <div><dt>Vai trò của bạn</dt><dd>Nhân viên</dd></div>
            </dl>
          )}
        </section>

        <section className="dashboard-card location-card">
          <div className="dashboard-card-heading">
            <div><span className="card-number">⌖</span><h2>Vị trí cửa hàng</h2></div>
            <p>Cần tọa độ để cửa hàng xuất hiện trong tìm kiếm bán kính 5 km.</p>
          </div>
          {membership.role === "owner" ? (
            <StoreLocationPicker
              initialLatitude={locationCoordinates?.latitude == null ? null : Number(locationCoordinates.latitude)}
              initialLongitude={locationCoordinates?.longitude == null ? null : Number(locationCoordinates.longitude)}
            />
          ) : (
            <p className="dashboard-help">Chỉ chủ cửa hàng mới có thể thay đổi vị trí.</p>
          )}
        </section>

        <section className="dashboard-card payment-settings-card">
          <div className="dashboard-card-heading">
            <div><span className="card-number">₫</span><h2>Thanh toán QR</h2></div>
            <p>Khoản chuyển sẽ về thẳng tài khoản ngân hàng của cửa hàng.</p>
          </div>
          {membership.role === "owner" ? (
            <form className="dashboard-form payment-settings-form" action={updateStorePaymentSettings}>
              <label>Ngân hàng<select name="bank_code" required defaultValue={paymentSettings?.bank_code ?? ""}>
                <option value="" disabled>Chọn ngân hàng</option>
                {banks.slice().sort((a, b) => a.fullName.localeCompare(b.fullName, "vi")).map((bank) => (
                  <option value={bank.code} key={bank.code}>{bank.fullName} ({bank.code})</option>
                ))}
              </select></label>
              <label>Số tài khoản<input name="account_number" required inputMode="numeric" pattern="[0-9]{6,30}" maxLength={30} defaultValue={paymentSettings?.account_number ?? ""} placeholder="Nhập số tài khoản" /></label>
              <label>Tên chủ tài khoản<input name="account_name" required minLength={2} maxLength={100} defaultValue={paymentSettings?.account_name ?? ""} placeholder="Ví dụ: NGUYEN VAN A" /></label>
              <label>Trạng thái<select name="is_enabled" defaultValue={paymentSettings?.is_enabled ? "true" : "false"}>
                <option value="true">Bật thanh toán QR</option>
                <option value="false">Tạm tắt thanh toán QR</option>
              </select></label>
              <p className="dashboard-help">Mỗi đơn có mã QR riêng gồm số tiền và nội dung chuyển khoản. Chủ cửa hàng cần tự kiểm tra biến động số dư rồi xác nhận đã nhận tiền trong trang Đơn hàng.</p>
              <button className="secondary-submit" type="submit">Lưu phương thức thanh toán</button>
            </form>
          ) : (
            <div className="payment-settings-summary">
              <p>{paymentSettings?.is_enabled ? "Thanh toán QR đang bật." : "Thanh toán QR đang tắt."}</p>
              {paymentSettings && <dl><div><dt>Ngân hàng</dt><dd>{paymentSettings.bank_name}</dd></div><div><dt>Số tài khoản</dt><dd>{paymentSettings.account_number}</dd></div><div><dt>Chủ tài khoản</dt><dd>{paymentSettings.account_name}</dd></div></dl>}
              <p className="dashboard-help">Chỉ chủ cửa hàng mới có thể thay đổi tài khoản nhận tiền.</p>
            </div>
          )}
        </section>

        <section className="dashboard-card payment-settings-card">
          <div className="dashboard-card-heading">
            <div><span className="card-number">⌖</span><h2>Giao hàng</h2></div>
            <p>Cửa hàng tự giao đơn đến khách trong bán kính đã chọn.</p>
          </div>
          {membership.role === "owner" ? (
            <form className="dashboard-form payment-settings-form" action={updateStoreDeliverySettings}>
              <label>Trạng thái giao hàng<select name="delivery_enabled" defaultValue={store.delivery_enabled ? "true" : "false"}>
                <option value="true">Bật giao tận nơi</option>
                <option value="false">Chỉ nhận tại cửa hàng</option>
              </select></label>
              <label>Bán kính giao hàng (km)<input name="delivery_radius_km" type="number" step="0.5" min="0.5" max="20" required defaultValue={Number(store.delivery_radius_m) / 1000} /></label>
              <label>Phí giao hàng (₫)<input name="delivery_fee_vnd" type="number" min="0" step="1000" required defaultValue={Number(store.delivery_fee_vnd)} /></label>
              <p className="dashboard-help">Khoảng cách tính đường chim bay từ tọa độ cửa hàng. Khách cần chia sẻ vị trí tại địa chỉ nhận; hãy lưu tọa độ cửa hàng trước khi bật giao hàng.</p>
              <button className="secondary-submit" type="submit">Lưu cài đặt giao hàng</button>
            </form>
          ) : (
            <div className="payment-settings-summary">
              <p>{store.delivery_enabled ? "Giao hàng đang bật." : "Cửa hàng hiện chỉ nhận khách tại quán."}</p>
              <dl>
                <div><dt>Bán kính</dt><dd>{Number(store.delivery_radius_m) / 1000} km</dd></div>
                <div><dt>Phí giao hàng</dt><dd>{Number(store.delivery_fee_vnd).toLocaleString("vi-VN")}₫</dd></div>
              </dl>
              <p className="dashboard-help">Chỉ chủ cửa hàng mới có thể thay đổi cài đặt giao hàng.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
