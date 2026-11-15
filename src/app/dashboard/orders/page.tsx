import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { confirmBankTransfer, updateOrderStatus } from "../actions";
import { dashboardMessages, formatPrice, getMerchantContext, orderStatusLabels } from "../data";

export const metadata: Metadata = { title: "Đơn hàng | Quản lý cửa hàng" };

export default async function MerchantOrdersPage({ searchParams }: { searchParams: Promise<{ message?: string; q?: string; filter_status?: string }> }) {
  const [{ supabase, store }, query] = await Promise.all([getMerchantContext(), searchParams]);
  if (!store) redirect("/dashboard");

  const search = (typeof query.q === "string" ? query.q : "")
    .trim()
    .replace(/[^\p{L}\p{N}\s+-]/gu, "")
    .slice(0, 60)
    .trim();
  const validStatuses = Object.keys(orderStatusLabels);
  const filterStatus = typeof query.filter_status === "string" && validStatuses.includes(query.filter_status)
    ? query.filter_status
    : "";
  let ordersQuery = supabase.from("orders")
    .select("id, public_code, customer_name, customer_phone, customer_note, status, fulfillment, delivery_address, delivery_latitude, delivery_longitude, delivery_distance_m, delivery_fee_vnd, payment_method, payment_status, payment_reference, total_vnd, created_at")
    .eq("store_id", store.id);
  if (search) {
    ordersQuery = ordersQuery.or(
      "public_code.ilike.%"+search+"%,customer_name.ilike.%"+search+"%,customer_phone.ilike.%"+search+"%",
    );
  }
  if (filterStatus) ordersQuery = ordersQuery.eq("status", filterStatus);
  const { data: orders } = await ordersQuery.order("created_at", { ascending: false }).limit(100);
  const orderIds = orders?.map((order) => order.id) ?? [];
  const { data: orderItems } = orderIds.length
    ? await supabase.from("order_items").select("id, order_id, product_name_snapshot, unit_price_snapshot_vnd, quantity").eq("store_id", store.id).in("order_id", orderIds)
    : { data: [] };
  const message = query.message ? dashboardMessages[query.message] : undefined;
  const nextActions: Record<string, Array<{ label: string; status: string; danger?: boolean }>> = {
    pending: [{ label: "Xác nhận", status: "confirmed" }, { label: "Từ chối", status: "rejected", danger: true }],
    confirmed: [{ label: "Bắt đầu chuẩn bị", status: "preparing" }],
    preparing: [{ label: "Sẵn sàng nhận", status: "ready" }],
    ready: [{ label: "Hoàn tất", status: "completed" }],
    out_for_delivery: [{ label: "Xác nhận đã giao", status: "completed" }],
  };

  return (
    <main className="admin-content">
      <div className="dashboard-kicker">QUẢN LÝ BÁN HÀNG</div>
      <h1 className="admin-page-title">Đơn hàng</h1>
      <p className="dashboard-intro">Theo dõi đơn của {store.name} và cập nhật tiến độ xử lý.</p>
      {message && <p className="dashboard-message" role="status">{message}</p>}
      <form className="dashboard-form merchant-order-filters" method="get">
        <label>Tìm đơn<input type="search" name="q" maxLength={60} defaultValue={search} placeholder="Mã đơn, tên hoặc số điện thoại" /></label>
        <label>Trạng thái<select name="filter_status" defaultValue={filterStatus}>
          <option value="">Tất cả trạng thái</option>
          {Object.entries(orderStatusLabels).map(([status, label]) => <option value={status} key={status}>{label}</option>)}
        </select></label>
        <div className="merchant-order-filter-actions">
          <button className="secondary-submit" type="submit">Lọc đơn</button>
          {(search || filterStatus) && <Link href="/dashboard/orders">Xóa bộ lọc</Link>}
        </div>
      </form>
      <section className="dashboard-card order-admin-card merchant-page-card">
        <div className="dashboard-card-heading">
          <div><span className="card-number">↗</span><h2>Danh sách đơn</h2></div>
          <p>{orders?.length ?? 0}{search || filterStatus ? " đơn phù hợp" : " đơn gần đây"}</p>
        </div>
        <div className="order-admin-list">
          {orders?.map((order) => {
            const actions = order.status === "ready" && order.fulfillment === "delivery"
              ? [{ label: "Bắt đầu giao", status: "out_for_delivery" }]
              : nextActions[order.status] ?? [];
            const items = orderItems?.filter((item) => item.order_id === order.id) ?? [];
            const isClosed = order.status === "cancelled" || order.status === "rejected";
            return (
              <article className="order-admin-row" key={order.id}>
                <div className="order-admin-top">
                  <div><b>{order.public_code}</b><span>{new Date(order.created_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</span></div>
                  <span className={"status-badge status-" + order.status}>{order.status === "ready" && order.fulfillment === "delivery" ? "Sẵn sàng giao" : orderStatusLabels[order.status] ?? order.status}</span>
                </div>
                <div className="order-customer"><b>{order.customer_name}</b><a href={"tel:" + order.customer_phone}>{order.customer_phone}</a></div>
                <div className="order-fulfillment-summary">
                  <b>{order.fulfillment === "delivery" ? "Giao tận nơi" : "Nhận tại cửa hàng"}</b>
                  {order.fulfillment === "delivery" && <>
                    <span>{order.delivery_address}</span>
                    <small>{order.delivery_distance_m == null ? "" : `${(Number(order.delivery_distance_m) / 1000).toFixed(1)} km`} · Phí giao {formatPrice(Number(order.delivery_fee_vnd))}</small>
                    {order.delivery_latitude != null && order.delivery_longitude != null && (
                      <a className="delivery-map-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${order.delivery_latitude},${order.delivery_longitude}`)}`} target="_blank" rel="noreferrer">Mở vị trí giao trên bản đồ ↗</a>
                    )}
                  </>}
                </div>
                {order.payment_method === "bank_transfer" && (
                  <div className="order-payment-summary">
                    <span>Chuyển khoản QR{order.payment_reference ? ` · ${order.payment_reference}` : ""}</span>
                    <span className={order.payment_status === "paid" ? "payment-paid-badge" : "payment-pending-badge"}>
                      {order.payment_status === "paid" ? "Đã nhận tiền" : isClosed ? "Đơn đã đóng" : "Chờ xác nhận tiền"}
                    </span>
                  </div>
                )}
                {order.payment_method === "cash_on_delivery" && <div className="order-payment-summary"><span>Tiền mặt khi nhận hàng</span></div>}
                <ul className="order-item-list">
                  {items.map((item) => <li key={item.id}><span>{item.product_name_snapshot} × {item.quantity}</span><b>{formatPrice(item.unit_price_snapshot_vnd * item.quantity)}</b></li>)}
                </ul>
                {order.customer_note && <p className="order-note">Ghi chú: {order.customer_note}</p>}
                <div className="order-admin-bottom">
                  <strong>{formatPrice(order.total_vnd)}</strong>
                  <div className="order-status-actions">
                    {actions.map((action) => (
                      <form action={updateOrderStatus} key={action.status}>
                        <input type="hidden" name="order_id" value={order.id} />
                        <input type="hidden" name="filter_query" value={search} />
                        <input type="hidden" name="filter_status" value={filterStatus} />
                        <button className={"order-action" + (action.danger ? " order-action-danger" : "")} type="submit" name="status" value={action.status}>{action.label}</button>
                      </form>
                    ))}
                    {order.payment_method === "bank_transfer" && order.payment_status === "awaiting_payment" && !isClosed && (
                      <form action={confirmBankTransfer}>
                        <input type="hidden" name="order_id" value={order.id} />
                        <input type="hidden" name="filter_query" value={search} />
                        <input type="hidden" name="filter_status" value={filterStatus} />
                        <button className="order-action" type="submit">Xác nhận đã nhận tiền</button>
                      </form>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
          {!orders?.length && (
            <div className="empty-row">
              {search || filterStatus
                ? "Không tìm thấy đơn phù hợp. Thử đổi từ khóa hoặc xóa bộ lọc."
                : "Chưa có đơn hàng. Đơn khách gửi sẽ xuất hiện tại đây."}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
