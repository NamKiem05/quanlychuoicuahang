import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { hasOrderWorkRemaining } from "@/lib/order-processing";
import { isRefundableOrder } from "@/lib/order-refunds";
import OrderPagination from "@/app/order-pagination";
import OrderDetailsModal from "@/app/order-details-modal";
import "@/app/order-list-status.css";

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
  await requirePlatformAdminAccess(supabase);
  const pageSize = 20;
  const rawPage = Number(query.page ?? 1);
  let currentPage = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 100_000 ? rawPage : 1;
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

  async function fetchOrders(page: number) {
    let ordersQuery = supabase
      .from("orders")
      .select("id, store_id, public_code, customer_name, customer_phone, customer_note, status, fulfillment, delivery_address, delivery_latitude, delivery_longitude, delivery_distance_m, delivery_fee_vnd, payment_method, payment_status, payment_reference, promotion_code, discount_vnd, cancellation_request_status, cancellation_request_reason, cancellation_requested_at, total_vnd, created_at", { count: "exact" })
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
    return ordersQuery.range((page - 1) * pageSize, page * pageSize - 1);
  }

  const initialPage = await fetchOrders(currentPage);
  let orders = initialPage.data;
  let ordersError = initialPage.error;
  const totalOrders = initialPage.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalOrders / pageSize));
  if (currentPage > totalPages) {
    currentPage = totalPages;
    ({ data: orders, error: ordersError } = await fetchOrders(currentPage));
  }

  const orderIds = orders?.map((order) => order.id) ?? [];
  const refundableOrderIds = orders?.filter(isRefundableOrder).map((order) => order.id) ?? [];
  const [{ data: items }, { data: refunds }] = await Promise.all([
    orderIds.length
      ? supabase.from("order_items").select("id, order_id, product_name_snapshot, unit_price_snapshot_vnd, quantity").in("order_id", orderIds)
      : { data: [] },
    refundableOrderIds.length
      ? supabase.from("orders").select("id, refunded_at").in("id", refundableOrderIds)
      : { data: [] },
  ]);
  const refundDates = new Map((refunds ?? []).map((order) => [order.id, order.refunded_at]));
  const storeById = new Map(storeRows.map((store) => [store.id, store]));

  return (
    <main className="admin-content">
      <div className="dashboard-kicker">GIÁM SÁT TOÀN NỀN TẢNG</div>
      <h1 className="admin-page-title">Đơn hàng</h1>
      <p className="dashboard-intro">Theo dõi đơn hàng và thanh toán của tất cả cửa hàng. Cửa hàng là nơi xử lý đơn.</p>
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

      <section className="admin-store-list admin-order-results">
        <div className="admin-list-heading">
          <div><h2>Danh sách đơn hàng</h2><p>Theo dõi đơn và thanh toán của các cửa hàng</p></div>
          <span>{totalOrders} đơn{totalOrders > pageSize ? " · sắp xếp mới nhất" : ""}</span>
        </div>
        <div className="admin-table-scroll">
          <table className="admin-data-table">
            <thead><tr><th>Mã đơn</th><th>Cửa hàng</th><th>Khách hàng</th><th>Sản phẩm</th><th>Tổng tiền</th><th>Trạng thái</th><th>Thanh toán</th><th>Thời gian đặt</th><th>Chi tiết</th></tr></thead>
            <tbody>
              {orders?.map((order) => {
                const store = storeById.get(order.store_id);
                const orderItems = items?.filter((item) => item.order_id === order.id) ?? [];
                const itemPreview = orderItems.slice(0, 2).map((item) => item.product_name_snapshot).join(", ");
                const extraItemCount = Math.max(0, orderItems.length - 2);
                const distanceLabel = order.delivery_distance_m == null
                  ? ""
                  : `${(Number(order.delivery_distance_m) / 1000).toFixed(1)} km`;
                const cancellationPending = order.cancellation_request_status === "pending";
                const hasWorkRemaining = hasOrderWorkRemaining(order, refundDates.get(order.id));
                const createdAt = new Date(order.created_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
                return (
                  <tr className={hasWorkRemaining ? undefined : "is-order-inactive"} key={order.id}>
                    <td><b className="admin-order-code">{order.public_code}</b><small>#{order.id.slice(0, 8)}</small></td>
                    <td><div className="admin-table-store"><b>{store?.name ?? "Cửa hàng không xác định"}</b>{store?.slug && <Link href={`/${store.slug}`} target="_blank">/{store.slug} ↗</Link>}</div></td>
                    <td><div className="admin-table-customer"><b>{order.customer_name}</b><a href={`tel:${order.customer_phone}`}>{order.customer_phone}</a></div></td>
                    <td><div className="admin-table-products"><span>{itemPreview || "Không có thông tin món"}</span>{extraItemCount > 0 && <small>và {extraItemCount} món khác</small>}</div></td>
                    <td><b className="admin-order-total">{formatPrice(Number(order.total_vnd))}</b></td>
                    <td><span className={`status-badge status-${order.status}`}>{order.status === "ready" && order.fulfillment === "delivery" ? "Sẵn sàng giao" : orderStatusLabels[order.status] ?? order.status}</span>{cancellationPending && <small className="order-cancellation-flag">Khách yêu cầu hủy</small>}</td>
                    <td><div className="admin-table-payment"><span>{paymentMethodLabels[order.payment_method] ?? order.payment_method}</span><small className={order.payment_status === "paid" ? "is-paid" : "is-unpaid"}>{paymentStatusLabels[order.payment_status] ?? order.payment_status}</small></div></td>
                    <td><time className="admin-order-time">{new Date(order.created_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</time></td>
                    <td>
                      <OrderDetailsModal orderCode={order.public_code} subtitle={`${store?.name ?? "Cửa hàng không xác định"} · ${createdAt}`} variant="admin" openOnLoad={query.open_order === order.id}>
                        <div className="order-modal-overview">
                          <div><small>Cửa hàng</small><b>{store?.name ?? "Cửa hàng không xác định"}</b>{store?.slug && <Link href={`/${store.slug}`} target="_blank">/{store.slug} ↗</Link>}</div>
                          <div><small>Khách hàng</small><b>{order.customer_name}</b><a href={`tel:${order.customer_phone}`}>{order.customer_phone}</a></div>
                          <div><small>Trạng thái đơn</small><span className={`status-badge status-${order.status}`}>{order.status === "ready" && order.fulfillment === "delivery" ? "Sẵn sàng giao" : orderStatusLabels[order.status] ?? order.status}</span></div>
                          <div><small>Tổng tiền</small><b>{formatPrice(Number(order.total_vnd))}</b></div>
                          <div><small>Thanh toán</small><b>{paymentMethodLabels[order.payment_method] ?? order.payment_method}</b><span>{paymentStatusLabels[order.payment_status] ?? order.payment_status}</span></div>
                          <div><small>Thời gian đặt</small><b>{createdAt}</b></div>
                        </div>
                        <section className="order-modal-section">
                          <h3>Các món trong đơn</h3>
                          <ul className="order-modal-item-list">{orderItems.map((item) => <li key={item.id}><span>{item.product_name_snapshot} × {item.quantity}</span><b>{formatPrice(Number(item.unit_price_snapshot_vnd) * item.quantity)}</b></li>)}</ul>
                          <div className="order-modal-total"><span>Tổng thanh toán</span><b>{formatPrice(Number(order.total_vnd))}</b></div>
                        </section>
                        <section className="order-modal-section">
                          <h3>Giao nhận và ghi chú</h3>
                          <div className="order-modal-facts">
                            <div><small>Hình thức nhận</small><b>{order.fulfillment === "delivery" ? "Giao tận nơi" : "Nhận tại cửa hàng"}</b></div>
                            {order.fulfillment === "delivery" && <>
                              <div><small>Địa chỉ giao hàng</small><b>{order.delivery_address || "Chưa có địa chỉ"}</b></div>
                              <div><small>Khoảng cách · phí giao</small><b>{distanceLabel || "—"} · {formatPrice(Number(order.delivery_fee_vnd))}</b></div>
                              {order.delivery_latitude != null && order.delivery_longitude != null && <a className="delivery-map-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${order.delivery_latitude},${order.delivery_longitude}`)}`} target="_blank" rel="noreferrer">Mở vị trí giao trên bản đồ ↗</a>}
                            </>}
                            {order.payment_reference && <div><small>Nội dung chuyển khoản</small><b>{order.payment_reference}</b></div>}
                            {order.customer_note && <div><small>Ghi chú khách hàng</small><b>{order.customer_note}</b></div>}
                            {Number(order.discount_vnd) > 0 && <div><small>Khuyến mãi</small><b>{order.promotion_code} · giảm {formatPrice(Number(order.discount_vnd))}</b></div>}
                          </div>
                        </section>
                        <section className="order-modal-section">
                          <h3>Theo dõi và ghi chú</h3>
                          {cancellationPending ? <div className="order-modal-cancellation">
                            <small>Khách yêu cầu hủy{order.cancellation_requested_at ? ` · ${new Date(order.cancellation_requested_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}` : ""}</small>
                            <b>{order.cancellation_request_reason || "Khách không ghi lý do."}</b>
                            {order.payment_method === "bank_transfer" && <p>Yêu cầu hủy đang chờ cửa hàng xem xét. Admin chỉ theo dõi; cửa hàng xử lý hủy và hoàn tiền nếu cần.</p>}
                            {order.payment_method !== "bank_transfer" && <p>Yêu cầu hủy đang chờ cửa hàng xem xét. Admin chỉ theo dõi trạng thái đơn.</p>}
                          </div> : order.cancellation_request_status === "declined"
                            ? <div className="order-modal-note">Yêu cầu hủy gần nhất đã bị cửa hàng từ chối.</div>
                            : <p className="order-modal-note">Chế độ chỉ xem: cửa hàng cập nhật trạng thái đơn và xác nhận thanh toán.</p>}
                        </section>
                      </OrderDetailsModal>
                    </td>
                  </tr>
                );
              })}
              {!orders?.length && <tr><td className="admin-table-empty" colSpan={9}>Không có đơn hàng khớp với bộ lọc.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <OrderPagination
        basePath="/admin/orders"
        currentPage={currentPage}
        pageSize={pageSize}
        totalItems={totalOrders}
        query={{ q: search, store_id: validStoreId, status, payment_status: paymentStatus, fulfillment }}
      />
    </main>
  );
}
