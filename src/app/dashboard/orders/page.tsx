import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { dashboardMessages, formatPrice, getMerchantContext, orderStatusLabels } from "../data";
import Toast from "@/app/toast";
import { toastVariantForMessage } from "@/lib/toast";
import { isRefundableOrder } from "@/lib/order-refunds";
import { canConfirmOrderBankTransfer, hasOrderWorkRemaining } from "@/lib/order-processing";
import OrderPagination from "@/app/order-pagination";
import OrderDetailsModal from "@/app/order-details-modal";
import "@/app/order-list-status.css";
import "./order-list.css";
import { filterParams, ordersQuery, readOrderFilters, type OrderParams } from "./order-filters";
import PrintOrdersButton from "./print-orders-button";
import OrderActionsMenu from "./order-actions-menu";

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

type OrderEvent = { id: number; order_id: string; event_type: string; old_value: string | null; new_value: string | null; created_at: string };
function describeEvent(event: OrderEvent) {
  const value = event.new_value ?? "";
  if (event.event_type === "status") return `Trạng thái đơn: ${orderStatusLabels[value] ?? value}`;
  if (event.event_type === "payment") return `Thanh toán: ${paymentStatusLabels[value] ?? value}`;
  if (event.event_type === "cancellation") return `Yêu cầu hủy: ${{ pending: "Chờ xử lý", accepted: "Đã chấp nhận", approved: "Đã chấp nhận", declined: "Đã từ chối" }[value] ?? value}`;
  if (event.event_type === "refund") return `Đã ghi nhận hoàn tiền${value && Number.isFinite(Number(value)) ? ` · ${formatPrice(Number(value))}` : ""}`;
  return "Đơn hàng được cập nhật";
}

export default async function MerchantOrdersPage({ searchParams }: { searchParams: Promise<OrderParams> }) {
  const [{ supabase, membership, store }, query] = await Promise.all([getMerchantContext(), searchParams]);
  if (!store) redirect("/dashboard");

  const storeId = store.id;
  const pageSize = 20;
  const rawPage = Number(query.page ?? 1);
  let currentPage = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 100_000 ? rawPage : 1;
  const filters = readOrderFilters(query);
  const search = filters.q;
  const filterStatus = filters.filter_status;
  const exportQuery = new URLSearchParams(filterParams(filters)).toString();
  async function fetchOrders(page: number) {
    const orderQuery = ordersQuery(supabase, storeId, filters);
    return (filters.error ? orderQuery.eq("id", "00000000-0000-0000-0000-000000000000") : orderQuery).range((page - 1) * pageSize, page * pageSize - 1);
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
  const refundableOrderIds = orders?.filter(isRefundableOrder).map((order) => order.id) ?? [];
  const [{ data: orderItems, error: itemsError }, refunds] = orderIds.length
    ? await Promise.all([
      supabase.from("order_items").select("id, order_id, product_name_snapshot, unit_price_snapshot_vnd, quantity").eq("store_id", storeId).in("order_id", orderIds),
      refundableOrderIds.length
        ? supabase.from("orders").select("id, refunded_at, refund_amount_vnd").eq("store_id", storeId).in("id", refundableOrderIds)
        : { data: [], error: null },
    ])
    : [{ data: [], error: null }, { data: [], error: null }];
  const orderEvents: OrderEvent[] = [];
  let historyError = false;
  if (orderIds.length) {
    for (let offset = 0; ; offset += 1000) {
      const result = await supabase.from("store_order_events").select("id, order_id, event_type, old_value, new_value, created_at").eq("store_id", storeId).in("order_id", orderIds).order("created_at").order("id").range(offset, offset + 999);
      if (result.error) { historyError = true; break; }
      orderEvents.push(...result.data as OrderEvent[]);
      if (result.data.length < 1000) break;
    }
  }
  const refundsByOrder = new Map((refunds.data ?? []).map((order) => [order.id, order]));
  const message = query.message ? dashboardMessages[query.message] : undefined;


  return (
    <main className="admin-content merchant-orders-page">
      <header className="merchant-orders-header"><div className="dashboard-kicker">QUẢN LÝ BÁN HÀNG / ĐƠN HÀNG</div>
      <h1 className="admin-page-title">Đơn hàng</h1>
      <p className="dashboard-intro">Theo dõi đơn của {store.name} và cập nhật tiến độ xử lý.</p></header>
      <Toast message={message} variant={query.message ? toastVariantForMessage(query.message) : "success"} />
      {orderLoadError && <p className="order-error" role="alert">Chưa tải được danh sách đơn. Hãy kiểm tra quyền Supabase và chạy các migration cần thiết, gồm migration 020 cho yêu cầu hủy đơn.</p>}
      {refunds.error && <p className="order-error" role="alert">Chưa tải được thông tin hoàn tiền. Hãy kiểm tra migration <code>202611160011_order_refunds.sql</code> trong Supabase rồi tải lại trang.</p>}
      {filters.error && <p className="order-error" role="alert">{filters.error}</p>}
      <form className="dashboard-form merchant-order-filters" method="get">
        <div className="merchant-order-filter-heading"><div><h2>Tìm kiếm & bộ lọc</h2><p>Chọn điều kiện để tìm nhanh đơn hàng cần xem.</p></div></div>
        <label>Tìm đơn<input type="search" name="q" maxLength={60} defaultValue={search} placeholder="Mã đơn, tên hoặc số điện thoại" /></label>
        <label>Trạng thái<select name="filter_status" defaultValue={filterStatus}>
          <option value="">Tất cả trạng thái</option>
          {Object.entries(orderStatusLabels).map(([status, label]) => <option value={status} key={status}>{label}</option>)}
        </select></label>
        <label>Phương thức thanh toán<select name="payment" defaultValue={filters.payment}><option value="">Tất cả phương thức</option>{Object.entries(paymentMethodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Từ ngày<input type="date" name="from" defaultValue={filters.from} /></label>
        <label>Đến ngày<input type="date" name="to" defaultValue={filters.to} /></label>
        <label>Giá trị từ (₫)<input type="number" name="min" min="0" step="1" defaultValue={filters.min} placeholder="Tối thiểu" /></label>
        <label>Giá trị đến (₫)<input type="number" name="max" min="0" step="1" defaultValue={filters.max} placeholder="Tối đa" /></label>
        <label>Sắp xếp<select name="sort" defaultValue={filters.sort}><option value="newest">Mới nhất</option><option value="oldest">Cũ nhất</option><option value="amount_high">Giá trị cao nhất</option><option value="amount_low">Giá trị thấp nhất</option></select></label>
        <div className="merchant-order-filter-actions">
          <button className="secondary-submit" type="submit">Lọc đơn</button>
          <Link href="/dashboard/orders">Xóa bộ lọc</Link>
        </div>
      </form>
      <section className="admin-store-list admin-order-results merchant-order-results">
        <div className="admin-list-heading">
          <div><h2>Danh sách đơn hàng</h2><p>Theo dõi đơn hàng và thanh toán của cửa hàng</p></div>
          <div className="merchant-order-export"><span>{totalOrders} đơn</span>{!filters.error && <><a className="merchant-order-excel" href={`/dashboard/orders/export?${exportQuery}`}><span aria-hidden="true">↓</span> Xuất Excel</a><PrintOrdersButton href={`/dashboard/orders/print?${exportQuery}`} /></>}</div>
        </div>
        <div className="admin-table-scroll">
          <table className="admin-data-table">
            <thead><tr><th>Mã đơn</th><th>Khách hàng</th><th>Sản phẩm</th><th>Tổng tiền</th><th>Trạng thái</th><th>Thanh toán</th><th>Thời gian đặt</th><th>Thao tác</th></tr></thead>
            <tbody>
          {orders?.map((order) => {
            const cancellationPending = order.cancellation_request_status === "pending";
            const items = orderItems?.filter((item) => item.order_id === order.id) ?? [];
            const refund = refundsByOrder.get(order.id);
            const canConfirmTransfer = canConfirmOrderBankTransfer(order);
            const hasWorkRemaining = hasOrderWorkRemaining(order, refund?.refunded_at);
            const paymentLabel = refund
              ? refund.refunded_at ? "Đã hoàn tiền" : "Chờ hoàn tiền"
              : paymentStatusLabels[order.payment_status] ?? order.payment_status;
            const paymentIsSettled = refund ? Boolean(refund.refunded_at) : order.payment_status === "paid";
            const itemPreview = items.slice(0, 2).map((item) => item.product_name_snapshot).join(", ");
            const extraItemCount = Math.max(0, items.length - 2);
            const distanceLabel = order.delivery_distance_m == null
              ? ""
              : `${(Number(order.delivery_distance_m) / 1000).toFixed(1)} km`;
            const createdAt = new Date(order.created_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
            return (
              <tr className={hasWorkRemaining ? undefined : "is-order-inactive"} key={order.id}>
                <td><b className="admin-order-code">{order.public_code}</b><small>#{order.id.slice(0, 8)}</small></td>
                <td><div className="admin-table-customer"><b>{order.customer_name}</b><a href={`tel:${order.customer_phone}`}>{order.customer_phone}</a></div></td>
                <td><div className="admin-table-products"><span>{itemPreview || "Không có thông tin món"}</span>{extraItemCount > 0 && <small>và {extraItemCount} món khác</small>}</div></td>
                <td><b className="admin-order-total">{formatPrice(Number(order.total_vnd))}</b></td>
                <td><span className={`status-badge status-${order.status}`}>{order.status === "ready" && order.fulfillment === "delivery" ? "Sẵn sàng giao" : orderStatusLabels[order.status] ?? order.status}</span>{cancellationPending && <small className="merchant-cancellation-flag">Khách yêu cầu hủy</small>}</td>
                <td><div className="admin-table-payment"><span>{paymentMethodLabels[order.payment_method] ?? order.payment_method}</span><small className={paymentIsSettled ? "is-paid" : "is-unpaid"}>{paymentLabel}</small></div></td>
                <td><time className="admin-order-time">{createdAt}</time></td>
                <td><div className="merchant-order-row-actions">
                  <OrderDetailsModal orderCode={order.public_code} subtitle={`${order.customer_name} · ${createdAt}`} variant="admin">
                    <div className="order-modal-overview">
                      <div><small>Khách hàng</small><b>{order.customer_name}</b><a href={`tel:${order.customer_phone}`}>{order.customer_phone}</a></div>
                      <div><small>Trạng thái đơn</small><span className={`status-badge status-${order.status}`}>{order.status === "ready" && order.fulfillment === "delivery" ? "Sẵn sàng giao" : orderStatusLabels[order.status] ?? order.status}</span></div>
                      <div><small>Tổng tiền</small><b>{formatPrice(Number(order.total_vnd))}</b></div>
                      <div><small>Phương thức thanh toán</small><b>{paymentMethodLabels[order.payment_method] ?? order.payment_method}</b></div>
                      <div><small>Trạng thái thanh toán</small><b>{paymentStatusLabels[order.payment_status] ?? order.payment_status}</b>{refund && <span>{paymentLabel}</span>}</div>
                      <div><small>Thời gian đặt</small><b>{createdAt}</b></div>
                    </div>
                    <section className="order-modal-section">
                      <h3>Sản phẩm trong đơn</h3>
                      {itemsError ? <p className="order-modal-note" role="alert">Chưa tải được danh sách sản phẩm.</p> : items.length ? <ul className="order-modal-item-list">{items.map((item) => <li key={item.id}><span>{item.product_name_snapshot}<small className="order-item-unit">{item.quantity} × {formatPrice(Number(item.unit_price_snapshot_vnd))}</small></span><b>{formatPrice(Number(item.unit_price_snapshot_vnd) * item.quantity)}</b></li>)}</ul> : <p className="order-modal-note">Không có thông tin sản phẩm.</p>}
                      <div className="order-price-breakdown"><div><span>Tiền sản phẩm</span><b>{formatPrice(Number(order.subtotal_vnd))}</b></div><div><span>Giảm giá{order.promotion_code ? ` · ${order.promotion_code}` : ""}</span><b>− {formatPrice(Number(order.discount_vnd ?? 0))}</b></div><div><span>Phí vận chuyển</span><b>{formatPrice(Number(order.delivery_fee_vnd ?? 0))}</b></div></div>
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
                        <div><small>Ghi chú khách hàng</small><b>{order.customer_note || "Không có ghi chú"}</b></div>
                      </div>
                    </section>
                    <section className="order-modal-section"><h3>Lịch sử xử lý đơn</h3><ol className="order-history"><li><b>Đơn hàng được tạo</b><time dateTime={order.created_at}>{createdAt}</time></li>{!historyError && orderEvents.filter((event) => event.order_id === order.id).map((event) => <li key={event.id}><b>{describeEvent(event)}</b><time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</time></li>)}</ol>{historyError ? <p className="order-modal-note" role="alert">Chưa tải được lịch sử. Hãy chạy migration 202611180019_order_processing_history.sql.</p> : <p className="order-modal-note">Các thay đổi được ghi nhận từ khi bật tính năng; lịch sử trước đó không được lưu.</p>}</section>
                    {(cancellationPending || order.cancellation_request_status === "declined" || refund) && <section className="order-modal-section"><h3>Thông tin xử lý</h3>
                      {cancellationPending && <p className="order-modal-note">Khách yêu cầu hủy{order.cancellation_requested_at ? ` · ${new Date(order.cancellation_requested_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}` : ""}: {order.cancellation_request_reason || "Không có lý do."}</p>}
                      {order.cancellation_request_status === "declined" && <p className="order-modal-note">Yêu cầu hủy gần nhất đã bị từ chối.</p>}
                      {refund && <p className="order-modal-note">{refund.refunded_at ? `Đã ghi nhận hoàn ${formatPrice(Number(refund.refund_amount_vnd))} lúc ${new Date(refund.refunded_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}.` : `Chờ hoàn ${formatPrice(Number(order.total_vnd))}.`}</p>}
                    </section>}
                  </OrderDetailsModal>
                  <OrderActionsMenu orderId={order.id} orderCode={order.public_code} status={order.status} fulfillment={order.fulfillment} cancellationPending={cancellationPending} canConfirmTransfer={canConfirmTransfer} canRefund={Boolean(refund && !refund.refunded_at && !refunds.error)} owner={membership?.role === "owner"} filters={filterParams(filters)} page={currentPage} />
                </div></td>
              </tr>
            );
          })}
              {!orders?.length && <tr><td className="admin-table-empty" colSpan={8}>{filters.error ? "Hãy sửa bộ lọc để xem danh sách đơn." : Object.values(filterParams(filters)).some((value) => value && value !== "newest") ? "Không tìm thấy đơn phù hợp. Thử đổi hoặc xóa bộ lọc." : "Chưa có đơn hàng. Đơn khách gửi sẽ xuất hiện tại đây."}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <OrderPagination
        basePath="/dashboard/orders"
        currentPage={currentPage}
        pageSize={pageSize}
        totalItems={totalOrders}
        query={filterParams(filters)}
      />
    </main>
  );
}
