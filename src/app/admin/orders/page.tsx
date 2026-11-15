import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Đơn hàng toàn nền tảng | Quản trị" };

const orderStatusLabels: Record<string, string> = {
  pending: "Chờ xác nhận",
  confirmed: "Đã xác nhận",
  preparing: "Đang chuẩn bị",
  ready: "Sẵn sàng nhận / giao",
  out_for_delivery: "Đang giao",
  completed: "Hoàn tất",
  cancelled: "Đã hủy",
  rejected: "Đã từ chối",
};

const paymentMethodLabels: Record<string, string> = {
  cash_on_pickup: "Tiền mặt khi nhận tại quán",
  cash_on_delivery: "Tiền mặt khi nhận hàng",
  bank_transfer: "Chuyển khoản QR",
};

const paymentStatusLabels: Record<string, string> = {
  unpaid: "Chưa thanh toán",
  awaiting_payment: "Chờ cửa hàng xác nhận",
  paid: "Đã xác nhận thanh toán",
};

const formatPrice = (value: number) => `${Number(value).toLocaleString("vi-VN")}₫`;

export default async function AdminOrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  const [query, supabase] = await Promise.all([searchParams, createClient()]);
  const search = (typeof query.q === "string" ? query.q : "")
    .trim()
    .replace(/[^\p{L}\p{N}\s+-.]/gu, "")
    .slice(0, 60)
    .trim();
  const validStatuses = Object.keys(orderStatusLabels);
  const status = typeof query.status === "string" && validStatuses.includes(query.status) ? query.status : "";
  const validPaymentStatuses = Object.keys(paymentStatusLabels);
  const paymentStatus = typeof query.payment_status === "string" && validPaymentStatuses.includes(query.payment_status)
    ? query.payment_status
    : "";
  const fulfillment = query.fulfillment === "pickup" || query.fulfillment === "delivery" ? query.fulfillment : "";
  const storeId = typeof query.store_id === "string" ? query.store_id : "";

  const [{ data: stores, error: storesError }] = await Promise.all([
    supabase.from("stores").select("id, name, slug").order("name"),
  ]);
  const storeRows = stores ?? [];
  const validStoreId = storeRows.some((store) => store.id === storeId) ? storeId : "";

  let ordersQuery = supabase
    .from("orders")
    .select("id, store_id, public_code, customer_name, customer_phone, customer_note, status, fulfillment, delivery_address, delivery_latitude, delivery_longitude, delivery_distance_m, delivery_fee_vnd, payment_method, payment_status, payment_reference, total_vnd, created_at")
    .order("created_at", { ascending: false });
  if (search) {
    ordersQuery = ordersQuery.or(
      `public_code.ilike.%${search}%,customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%`,
    );
  }
  if (status) ordersQuery = ordersQuery.eq("status", status);
  if (paymentStatus) ordersQuery = ordersQuery.eq("payment_status", paymentStatus);
  if (fulfillment) ordersQuery = ordersQuery.eq("fulfillment", fulfillment);
  if (validStoreId) ordersQuery = ordersQuery.eq("store_id", validStoreId);
  const { data: orders, error: ordersError } = await ordersQuery.limit(100);

  const orderIds = orders?.map((order) => order.id) ?? [];
  const { data: items } = orderIds.length
    ? await supabase
        .from("order_items")
        .select("id, order_id, product_name_snapshot, unit_price_snapshot_vnd, quantity")
        .in("order_id", orderIds)
    : { data: [] };
  const storeById = new Map(storeRows.map((store) => [store.id, store]));

  return (
    <main className="admin-content">
      <div className="dashboard-kicker">GIÁM SÁT TOÀN NỀN TẢNG</div>
      <h1 className="admin-page-title">Đơn hàng</h1>
      <p className="dashboard-intro">Theo dõi đơn của tất cả cửa hàng. Chủ quán vẫn phụ trách xác nhận, giao món và nhận thanh toán.</p>
      {(storesError || ordersError) && <p className="admin-error" role="alert">Chưa tải được dữ liệu đơn hàng. Hãy kiểm tra migration và quyền admin rồi tải lại trang.</p>}

      <form className="dashboard-form merchant-order-filters admin-order-filters" method="get">
        <label>Tìm đơn<input type="search" name="q" maxLength={60} defaultValue={search} placeholder="Mã đơn, tên hoặc số điện thoại" /></label>
        <label>Cửa hàng<select name="store_id" defaultValue={validStoreId}>
          <option value="">Tất cả cửa hàng</option>
          {storeRows.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
        </select></label>
        <label>Trạng thái đơn<select name="status" defaultValue={status}>
          <option value="">Tất cả</option>
          {Object.entries(orderStatusLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
        </select></label>
        <label>Thanh toán<select name="payment_status" defaultValue={paymentStatus}>
          <option value="">Tất cả</option>
          {Object.entries(paymentStatusLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
        </select></label>
        <label>Hình thức nhận<select name="fulfillment" defaultValue={fulfillment}>
          <option value="">Tất cả</option>
          <option value="pickup">Nhận tại quán</option>
          <option value="delivery">Giao tận nơi</option>
        </select></label>
        <div className="merchant-order-filter-actions">
          <button className="secondary-submit" type="submit">Lọc đơn</button>
          {(search || validStoreId || status || paymentStatus || fulfillment) && <Link href="/admin/orders">Xóa bộ lọc</Link>}
        </div>
      </form>

      <section className="dashboard-card order-admin-card admin-order-results">
        <div className="dashboard-card-heading">
          <div><span className="card-number">▤</span><h2>Đơn gần đây</h2></div>
          <p>{orders?.length ?? 0} đơn{(orders?.length ?? 0) === 100 ? " · hiển thị tối đa 100 đơn gần nhất" : ""}</p>
        </div>
        <div className="order-admin-list">
          {orders?.map((order) => {
            const store = storeById.get(order.store_id);
            const orderItems = items?.filter((item) => item.order_id === order.id) ?? [];
            const distanceLabel = order.delivery_distance_m == null
              ? ""
              : `${(Number(order.delivery_distance_m) / 1000).toFixed(1)} km`;
            return (
              <article className="order-admin-row" key={order.id}>
                <div className="order-admin-top">
                  <div><b>{order.public_code}</b><span>{new Date(order.created_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</span></div>
                  <span className={`status-badge status-${order.status}`}>{order.status === "ready" && order.fulfillment === "delivery" ? "Sẵn sàng giao" : orderStatusLabels[order.status] ?? order.status}</span>
                </div>
                <div className="admin-order-store-link">
                  <span>{store?.name ?? "Cửa hàng không xác định"}</span>
                  {store?.slug && <Link href={`/${store.slug}`} target="_blank">Mở gian hàng ↗</Link>}
                </div>
                <div className="order-customer"><b>{order.customer_name}</b><a href={`tel:${order.customer_phone}`}>{order.customer_phone}</a></div>
                <div className="order-fulfillment-summary">
                  <b>{order.fulfillment === "delivery" ? "Giao tận nơi" : "Nhận tại cửa hàng"}</b>
                  {order.fulfillment === "delivery" && <>
                    <span>{order.delivery_address}</span>
                    <small>{distanceLabel} · Phí giao {formatPrice(Number(order.delivery_fee_vnd))}</small>
                  </>}
                </div>
                <div className="admin-order-payment">
                  <span>{paymentMethodLabels[order.payment_method] ?? order.payment_method}</span>
                  {order.payment_method === "bank_transfer" && order.payment_reference && <code>{order.payment_reference}</code>}
                  <b className={order.payment_status === "paid" ? "payment-paid-badge" : "payment-pending-badge"}>
                    {paymentStatusLabels[order.payment_status] ?? order.payment_status}
                  </b>
                </div>
                <ul className="order-item-list">
                  {orderItems.map((item) => <li key={item.id}><span>{item.product_name_snapshot} × {item.quantity}</span><b>{formatPrice(Number(item.unit_price_snapshot_vnd) * item.quantity)}</b></li>)}
                </ul>
                {order.customer_note && <p className="order-note">Ghi chú: {order.customer_note}</p>}
                <div className="order-admin-bottom"><strong>{formatPrice(Number(order.total_vnd))}</strong></div>
              </article>
            );
          })}
          {!orders?.length && <div className="empty-row">Không có đơn hàng khớp với bộ lọc.</div>}
        </div>
      </section>
    </main>
  );
}
