import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { confirmBankTransfer, decideOrderCancellation, updateOrderStatus } from "../actions";
import { dashboardMessages, formatPrice, getMerchantContext, orderStatusLabels } from "../data";
import Toast from "@/app/toast";
import { toastVariantForMessage } from "@/lib/toast";
import OrderPagination from "@/app/order-pagination";
import OrderDetailsModal from "@/app/order-details-modal";

export const metadata: Metadata = { title: "Đơn hàng | Quản lý cửa hàng" };

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

export default async function MerchantOrdersPage({ searchParams }: { searchParams: Promise<{ message?: string; q?: string; filter_status?: string; page?: string }> }) {
  const [{ supabase, store }, query] = await Promise.all([getMerchantContext(), searchParams]);
  if (!store) redirect("/dashboard");

  const storeId = store.id;
  const pageSize = 20;
  const rawPage = Number(query.page ?? 1);
  let currentPage = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 100_000 ? rawPage : 1;
  const search = (typeof query.q === "string" ? query.q : "")
    .trim()
    .replace(/[^\p{L}\p{N}\s+-]/gu, "")
    .slice(0, 60)
    .trim();
  const validStatuses = Object.keys(orderStatusLabels);
  const filterStatus = typeof query.filter_status === "string" && validStatuses.includes(query.filter_status)
    ? query.filter_status
    : "";
  async function fetchOrders(page: number) {
    let ordersQuery = supabase.from("orders")
      .select("id, public_code, customer_name, customer_phone, customer_note, status, fulfillment, delivery_address, delivery_latitude, delivery_longitude, delivery_distance_m, delivery_fee_vnd, payment_method, payment_status, payment_reference, promotion_code, discount_vnd, cancellation_request_status, cancellation_request_reason, cancellation_requested_at, cancellation_decided_at, total_vnd, created_at", { count: "exact" })
      .eq("store_id", storeId)
      .order("created_at", { ascending: false });
    if (search) {
      ordersQuery = ordersQuery.or(
        "public_code.ilike.%"+search+"%,customer_name.ilike.%"+search+"%,customer_phone.ilike.%"+search+"%",
      );
    }
    if (filterStatus) ordersQuery = ordersQuery.eq("status", filterStatus);
    return ordersQuery.range((page - 1) * pageSize, page * pageSize - 1);
  }
  const initialPage = await fetchOrders(currentPage);
  const orderLoadError = initialPage.error;
  let orders = initialPage.data;
  const totalOrders = initialPage.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalOrders / pageSize));
  if (currentPage > totalPages) {
    currentPage = totalPages;
    ({ data: orders } = await fetchOrders(currentPage));
  }
  const orderIds = orders?.map((order) => order.id) ?? [];
  const { data: orderItems } = orderIds.length
    ? await supabase.from("order_items").select("id, order_id, product_name_snapshot, unit_price_snapshot_vnd, quantity").eq("store_id", storeId).in("order_id", orderIds)
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
      <Toast message={message} variant={query.message ? toastVariantForMessage(query.message) : "success"} />
      {orderLoadError && <p className="order-error" role="alert">Chưa tải được danh sách đơn. Hãy kiểm tra quyền Supabase và chạy các migration cần thiết, gồm migration 020 cho yêu cầu hủy đơn.</p>}
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
      <section className="admin-store-list admin-order-results merchant-order-results">
        <div className="admin-list-heading">
          <div><h2>Danh sách đơn hàng</h2><p>Theo dõi đơn hàng và thanh toán của cửa hàng</p></div>
          <span>{totalOrders} đơn</span>
        </div>
        <div className="admin-table-scroll">
          <table className="admin-data-table">
            <thead><tr><th>Mã đơn</th><th>Khách hàng</th><th>Sản phẩm</th><th>Tổng tiền</th><th>Trạng thái</th><th>Thanh toán</th><th>Thời gian đặt</th><th>Chi tiết</th></tr></thead>
            <tbody>
          {orders?.map((order) => {
            const cancellationPending = order.cancellation_request_status === "pending";
            const actions = cancellationPending ? [] : order.status === "ready" && order.fulfillment === "delivery"
              ? [{ label: "Bắt đầu giao", status: "out_for_delivery" }]
              : nextActions[order.status] ?? [];
            const items = orderItems?.filter((item) => item.order_id === order.id) ?? [];
            const isClosed = order.status === "cancelled" || order.status === "rejected";
            const itemPreview = items.slice(0, 2).map((item) => item.product_name_snapshot).join(", ");
            const extraItemCount = Math.max(0, items.length - 2);
            const distanceLabel = order.delivery_distance_m == null
              ? ""
              : `${(Number(order.delivery_distance_m) / 1000).toFixed(1)} km`;
            const createdAt = new Date(order.created_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
            return (
              <tr className={order.status === "completed" || order.status === "cancelled" ? "is-order-closed" : undefined} key={order.id}>
                <td><b className="admin-order-code">{order.public_code}</b><small>#{order.id.slice(0, 8)}</small></td>
                <td><div className="admin-table-customer"><b>{order.customer_name}</b><a href={`tel:${order.customer_phone}`}>{order.customer_phone}</a></div></td>
                <td><div className="admin-table-products"><span>{itemPreview || "Không có thông tin món"}</span>{extraItemCount > 0 && <small>và {extraItemCount} món khác</small>}</div></td>
                <td><b className="admin-order-total">{formatPrice(Number(order.total_vnd))}</b></td>
                <td><span className={`status-badge status-${order.status}`}>{order.status === "ready" && order.fulfillment === "delivery" ? "Sẵn sàng giao" : orderStatusLabels[order.status] ?? order.status}</span>{cancellationPending && <small className="merchant-cancellation-flag">Khách yêu cầu hủy</small>}</td>
                <td><div className="admin-table-payment"><span>{paymentMethodLabels[order.payment_method] ?? order.payment_method}</span><small className={order.payment_status === "paid" ? "is-paid" : "is-unpaid"}>{paymentStatusLabels[order.payment_status] ?? order.payment_status}</small></div></td>
                <td><time className="admin-order-time">{createdAt}</time></td>
                <td>
                  <OrderDetailsModal orderCode={order.public_code} subtitle={`${order.customer_name} · ${createdAt}`} variant="admin">
                    <div className="order-modal-overview">
                      <div><small>Khách hàng</small><b>{order.customer_name}</b><a href={`tel:${order.customer_phone}`}>{order.customer_phone}</a></div>
                      <div><small>Trạng thái đơn</small><span className={`status-badge status-${order.status}`}>{order.status === "ready" && order.fulfillment === "delivery" ? "Sẵn sàng giao" : orderStatusLabels[order.status] ?? order.status}</span></div>
                      <div><small>Tổng tiền</small><b>{formatPrice(Number(order.total_vnd))}</b></div>
                      <div><small>Thanh toán</small><b>{paymentMethodLabels[order.payment_method] ?? order.payment_method}</b><span>{paymentStatusLabels[order.payment_status] ?? order.payment_status}</span></div>
                      <div><small>Thời gian đặt</small><b>{createdAt}</b></div>
                    </div>
                    <section className="order-modal-section">
                      <h3>Các món trong đơn</h3>
                      <ul className="order-modal-item-list">{items.map((item) => <li key={item.id}><span>{item.product_name_snapshot} × {item.quantity}</span><b>{formatPrice(Number(item.unit_price_snapshot_vnd) * item.quantity)}</b></li>)}</ul>
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
                      <h3>Thao tác</h3>
                      {cancellationPending && <div className="order-modal-cancellation">
                        <small>Khách yêu cầu hủy{order.cancellation_requested_at ? ` · ${new Date(order.cancellation_requested_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}` : ""}</small>
                        <b>{order.cancellation_request_reason || "Khách không ghi lý do."}</b>
                        {order.payment_method === "bank_transfer" && <p>Nếu khách đã chuyển khoản, cần xử lý hoàn tiền thủ công sau khi chấp nhận.</p>}
                        <form action={decideOrderCancellation} className="order-modal-actions">
                          <input type="hidden" name="order_id" value={order.id} /><input type="hidden" name="filter_query" value={search} />
                          <input type="hidden" name="filter_status" value={filterStatus} /><input type="hidden" name="filter_page" value={currentPage} />
                          <button className="order-action" type="submit" name="decision" value="accept">Chấp nhận hủy</button>
                          <button className="order-action order-action-danger" type="submit" name="decision" value="decline">Từ chối yêu cầu</button>
                        </form>
                      </div>}
                      {order.cancellation_request_status === "declined" && <div className="order-modal-note">Yêu cầu hủy gần nhất đã bị từ chối.</div>}
                      {!cancellationPending && (actions.length > 0 || (order.payment_method === "bank_transfer" && order.payment_status === "awaiting_payment" && !isClosed)) ? <div className="order-modal-actions">
                        {actions.map((action) => <form action={updateOrderStatus} key={action.status}>
                          <input type="hidden" name="order_id" value={order.id} /><input type="hidden" name="filter_query" value={search} />
                          <input type="hidden" name="filter_status" value={filterStatus} /><input type="hidden" name="filter_page" value={currentPage} />
                          <button className={`order-action${action.danger ? " order-action-danger" : ""}`} type="submit" name="status" value={action.status}>{action.label}</button>
                        </form>)}
                        {order.payment_method === "bank_transfer" && order.payment_status === "awaiting_payment" && !isClosed && <form action={confirmBankTransfer}>
                          <input type="hidden" name="order_id" value={order.id} /><input type="hidden" name="filter_query" value={search} />
                          <input type="hidden" name="filter_status" value={filterStatus} /><input type="hidden" name="filter_page" value={currentPage} />
                          <button className="order-action" type="submit">Xác nhận đã nhận tiền</button>
                        </form>}
                      </div> : !cancellationPending && <p className="order-modal-note">Đơn hàng không còn thao tác cần xử lý.</p>}
                    </section>
                  </OrderDetailsModal>
                </td>
              </tr>
            );
          })}
              {!orders?.length && <tr><td className="admin-table-empty" colSpan={8}>{search || filterStatus ? "Không tìm thấy đơn phù hợp. Thử đổi từ khóa hoặc xóa bộ lọc." : "Chưa có đơn hàng. Đơn khách gửi sẽ xuất hiện tại đây."}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <OrderPagination
        basePath="/dashboard/orders"
        currentPage={currentPage}
        pageSize={pageSize}
        totalItems={totalOrders}
        query={{ q: search, filter_status: filterStatus }}
      />
    </main>
  );
}
