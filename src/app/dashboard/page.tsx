import type { Metadata } from "next";
import Link from "next/link";
import OverviewRevenue, { type RevenueSearchParams } from "@/app/overview-revenue";
import { createStore } from "./actions";
import StoreLocationPicker from "./store/location-picker";
import { dashboardMessages, formatPrice, getMerchantContext, orderStatusLabels } from "./data";
import Toast from "@/app/toast";
import { toastVariantForMessage } from "@/lib/toast";
import "./merchant-overview.css";

type MerchantOverview = {
  revenue_today: number; revenue_month: number; revenue_year: number;
  total_orders: number; new_orders: number; processing_orders: number; completed_orders: number; cancelled_orders: number;
  total_customers: number; new_customers_month: number; low_stock: number;
  daily_orders: { day: string; total: number }[];
  top_revenue_products: { product_name: string; quantity: number; revenue: number }[];
  top_customers: { customer_name: string; order_count: number }[];
};

export const metadata: Metadata = { title: "Tổng quan cửa hàng | Bếp Nhà Mơ" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<RevenueSearchParams & { message?: string }> }) {
  const [{ supabase, store, membership }, query] = await Promise.all([getMerchantContext(), searchParams]);
  const message = query.message ? dashboardMessages[query.message] : undefined;

  if (!store) {
    return (
      <main className="admin-content">
        <div className="dashboard-kicker">KHU VỰC CHỦ CỬA HÀNG</div>
        <h1 className="admin-page-title">Tạo gian hàng đầu tiên</h1>
        <p className="dashboard-intro">Tạo trang bán hàng riêng để bắt đầu đăng món và nhận đơn.</p>
        <Toast message={message} variant={query.message ? toastVariantForMessage(query.message) : "success"} />
        <section className="dashboard-card store-setup-card">
          <div className="dashboard-card-heading">
            <div><span className="card-number">01</span><h2>Thông tin cửa hàng</h2></div>
            <p>Tên cửa hàng sẽ hiện trên website riêng của bạn.</p>
          </div>
          <form className="dashboard-form" action={createStore}>
            <label>Tên cửa hàng<input name="name" required maxLength={120} placeholder="Ví dụ: Bếp Nhà Mơ" /></label>
            <label>Đường dẫn cửa hàng <span className="field-hint">Có thể tự tạo từ tên nếu để trống</span><input name="slug" maxLength={80} placeholder="bep-nha-mo" /></label>
            <div className="form-row">
              <label>Số điện thoại<input name="phone" type="tel" maxLength={30} placeholder="090 123 4567" /></label>
              <label>Địa chỉ<input name="address" maxLength={255} placeholder="Địa chỉ cửa hàng" /></label>
            </div>
            <fieldset className="store-setup-location">
              <legend>Vị trí cửa hàng <span className="field-hint">Tùy chọn</span></legend>
              <StoreLocationPicker initialLatitude={null} initialLongitude={null} embedded />
              <p className="dashboard-help">Bạn có thể bổ sung vị trí sau trong mục Quản lý cửa hàng.</p>
            </fieldset>
            <button className="primary-button dashboard-submit" type="submit">Tạo gian hàng <span>→</span></button>
          </form>
        </section>
      </main>
    );
  }

  const { data: planAllowsOrders, error: planStatusError } = await supabase.rpc("merchant_plan_allows_orders", { target_store: store.id });

  const [
    { count: productCount, error: productError },
    { count: pendingOrderCount, error: orderCountError },
    { count: pendingReviewCount, error: reviewCountError },
    { data: latestOrders, error: latestOrdersError },
    overviewResult,
  ] = await Promise.all([
    supabase.from("products").select("id", { count: "exact", head: true }).eq("store_id", store.id).neq("status", "archived"),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("store_id", store.id).eq("status", "pending"),
    supabase.from("reviews").select("id", { count: "exact", head: true }).eq("store_id", store.id).eq("status", "pending"),
    supabase.from("orders").select("id, public_code, status, total_vnd, created_at").eq("store_id", store.id).order("created_at", { ascending: false }).limit(5),
    supabase.rpc("get_merchant_overview", { p_store_id: store.id }),
  ]);
  const overview = overviewResult.data as MerchantOverview | null;
  const overviewReady = !overviewResult.error && overview !== null;
  const count = (value: number | undefined) => overviewReady && value != null ? Number(value).toLocaleString("vi-VN") : "—";
  const money = (value: number | undefined) => overviewReady && value != null ? formatPrice(Number(value)) : "—";
  const maxDailyOrders = Math.max(1, ...(overview?.daily_orders ?? []).map((item) => Number(item.total)));

  return (
    <main className="admin-content merchant-dashboard">
      <div className="admin-page-heading merchant-dashboard-heading">
        <span className="admin-page-heading-icon" aria-hidden="true">▦</span>
        <div className="merchant-dashboard-heading-copy">
          <div className="dashboard-kicker"><span className="dashboard-live-dot" /> TỔNG QUAN CỬA HÀNG</div>
          <h1 className="admin-page-title">Xin chào, {store.name}</h1>
          <p className="dashboard-intro">Cùng xem nhanh tình hình hoạt động của cửa hàng hôm nay.</p>
        </div>
        <Link className="merchant-heading-action" href="/dashboard/orders">Quản lý đơn hàng <span>→</span></Link>
      </div>
      <Toast message={message} variant={query.message ? toastVariantForMessage(query.message) : "success"} />

      <section className="merchant-store-banner">
        <div className="merchant-store-banner-copy">
          <span className="merchant-banner-label">GIAN HÀNG CỦA BẠN</span>
          <b>{store.name}</b>
          <span className="merchant-store-url">/{store.slug}</span>
        </div>
        <div className="merchant-store-banner-actions">
          <span className={"status-badge status-" + store.status}>{store.status === "active" ? (planStatusError || planAllowsOrders == null ? "Chưa xác định trạng thái nhận đơn" : store.accepts_orders && planAllowsOrders ? "Đang nhận đơn" : "Đã tạm ngưng nhận đơn") : store.status === "suspended" ? "Đã tạm dừng" : "Chờ duyệt"}</span>
          {store.status === "active" && <a className="store-preview-link" href={"/" + store.slug}>Xem website ↗</a>}
        </div>
        <span className="merchant-store-banner-art" aria-hidden="true">✳</span>
      </section>
      {store.status !== "active" && <p className="dashboard-help approval-note">{store.status === "suspended" ? "Gian hàng đang tạm dừng. Vui lòng liên hệ quản trị nền tảng để được hỗ trợ." : "Gian hàng đang chờ admin nền tảng duyệt trước khi hiển thị công khai."}</p>}
      {(planStatusError || planAllowsOrders == null) && <p className="dashboard-help approval-note" role="alert">Chưa kiểm tra được trạng thái gói dịch vụ. Vui lòng tải lại trang.</p>}
      {planAllowsOrders === false && (
        <p className="dashboard-help approval-note">
          Gói dịch vụ đã hết hạn. Cửa hàng tạm dừng nhận đơn mới. {membership?.role === "owner" && <Link className="store-preview-link" href="/merchant-plan">Gia hạn gói →</Link>}
        </p>
      )}

      {!overviewReady && <p className="dashboard-help approval-note" role="alert">Chưa tải được thống kê tổng quan. Hãy kiểm tra migration 202611180017_merchant_overview.sql và tải lại trang.</p>}
      <section className="merchant-overview-section" aria-labelledby="merchant-business-title">
        <div className="merchant-section-heading"><div><span>HIỆU QUẢ KINH DOANH</span><h2 id="merchant-business-title">Tổng quan bán hàng</h2></div><small>Giờ Việt Nam · cập nhật khi tải trang</small></div>
        <div className="merchant-overview-metrics">
          <article className="merchant-overview-money"><span>Doanh thu hôm nay</span><strong>{money(overview?.revenue_today)}</strong><small>Đơn đã thanh toán</small></article>
          <article className="merchant-overview-money"><span>Doanh thu tháng này</span><strong>{money(overview?.revenue_month)}</strong><small>Từ đầu tháng đến hôm nay</small></article>
          <article className="merchant-overview-money"><span>Doanh thu năm nay</span><strong>{money(overview?.revenue_year)}</strong><small>Từ đầu năm đến hôm nay</small></article>
          <article><span>Tổng đơn hàng</span><strong>{count(overview?.total_orders)}</strong><small>Tất cả trạng thái</small></article>
          <article><span>Đơn hàng mới</span><strong>{count(overview?.new_orders)}</strong><small>Chờ xác nhận</small></article>
          <article><span>Đang xử lý</span><strong>{count(overview?.processing_orders)}</strong><small>Đã xác nhận đến đang giao</small></article>
          <article><span>Hoàn thành</span><strong>{count(overview?.completed_orders)}</strong><small>Đơn đã hoàn tất</small></article>
          <article><span>Đã hủy / từ chối</span><strong>{count(overview?.cancelled_orders)}</strong><small>Tổng số đơn</small></article>
          <article><span>Khách hàng</span><strong>{count(overview?.total_customers)}</strong><small>Theo số điện thoại đặt hàng</small></article>
          <article><span>Khách hàng mới</span><strong>{count(overview?.new_customers_month)}</strong><small>Đơn đầu tiên trong tháng</small></article>
          <article><span>Sản phẩm sắp hết</span><strong>{count(overview?.low_stock)}</strong><small>Theo ngưỡng tồn kho</small></article>
        </div>
        <p className="merchant-overview-caption">Doanh thu tính theo ngày xác nhận thanh toán, không bao gồm đơn bị hủy hoặc từ chối. Khách hàng được nhận diện theo số điện thoại trong đơn.</p>
      </section>

      <div className="admin-stat-grid merchant-stat-grid">
        <article className="merchant-stat-card merchant-stat-products">
          <span className="merchant-stat-icon" aria-hidden="true">☷</span>
          <div><small>MÓN ĐANG QUẢN LÝ</small><b>{productError ? "—" : productCount ?? 0}</b><span>{productError ? "Chưa tải được dữ liệu" : "Món trong thực đơn"}</span></div>
          <Link href="/dashboard/menu" aria-label="Mở thực đơn">↗</Link>
        </article>
        <article className="merchant-stat-card merchant-stat-orders">
          <span className="merchant-stat-icon" aria-hidden="true">↗</span>
          <div><small>ĐƠN CHỜ XÁC NHẬN</small><b>{orderCountError ? "—" : pendingOrderCount ?? 0}</b><span>{orderCountError ? "Chưa tải được dữ liệu" : "Đơn mới cần xử lý"}</span></div>
          <Link href="/dashboard/orders" aria-label="Mở đơn hàng">↗</Link>
        </article>
        <article className="merchant-stat-card merchant-stat-reviews">
          <span className="merchant-stat-icon" aria-hidden="true">★</span>
          <div><small>ĐÁNH GIÁ CHỜ DUYỆT</small><b>{reviewCountError ? "—" : pendingReviewCount ?? 0}</b><span>{reviewCountError ? "Chưa tải được dữ liệu" : "Phản hồi khách hàng"}</span></div>
          <Link href="/dashboard/reviews" aria-label="Mở đánh giá">↗</Link>
        </article>
      </div>

      <OverviewRevenue supabase={supabase} storeId={store.id} query={query} path="/dashboard" />

      <div className="merchant-overview-panels">
        <section className="merchant-overview-panel"><div className="merchant-overview-panel-heading"><div><span>7 NGÀY GẦN NHẤT</span><h2>Biểu đồ đơn hàng</h2></div></div>
          {!overviewReady ? <p className="merchant-overview-empty">Chưa tải được dữ liệu.</p> : <div className="merchant-order-chart">{overview?.daily_orders.map((day) => <div key={day.day}><strong>{count(day.total)}</strong><span className="merchant-order-bar-track"><span style={{ height: `${Number(day.total) / maxDailyOrders * 100}%` }} /></span><small>{day.day.slice(8, 10)}/{day.day.slice(5, 7)}</small></div>)}</div>}
          <p className="merchant-overview-caption">Tính theo ngày đặt đơn, bao gồm mọi trạng thái.</p>
        </section>
        <section className="merchant-overview-panel"><div className="merchant-overview-panel-heading"><div><span>CẦN CHÚ Ý</span><h2>Thông báo cần xử lý</h2></div></div>
          <div className="merchant-overview-alerts"><Link href="/dashboard/orders"><span>Đơn chờ xác nhận</span><b>{count(overview?.new_orders)} →</b></Link><Link href="/dashboard/menu"><span>Sản phẩm sắp hết hàng</span><b>{count(overview?.low_stock)} →</b></Link><Link href="/dashboard/reviews"><span>Đánh giá chờ duyệt</span><b>{reviewCountError ? "—" : pendingReviewCount ?? 0} →</b></Link></div>
        </section>
        <section className="merchant-overview-panel"><div className="merchant-overview-panel-heading"><div><span>ĐƠN ĐÃ THANH TOÁN</span><h2>Top sản phẩm doanh thu cao</h2></div></div>
          {!overviewReady ? <p className="merchant-overview-empty">Chưa tải được dữ liệu.</p> : !overview?.top_revenue_products.length ? <p className="merchant-overview-empty">Chưa có sản phẩm trong đơn đã thanh toán.</p> : <ol className="merchant-overview-ranking">{overview.top_revenue_products.map((product, index) => <li key={`${product.product_name}-${index}`}><span>{index + 1}</span><div><b>{product.product_name}</b><small>{count(product.quantity)} sản phẩm</small></div><strong>{money(product.revenue)}</strong></li>)}</ol>}
          <p className="merchant-overview-caption">Tính giá sản phẩm trong đơn, chưa phân bổ khuyến mãi hoặc phí giao hàng; không trừ hoàn tiền.</p>
        </section>
        <section className="merchant-overview-panel"><div className="merchant-overview-panel-heading"><div><span>KHÁCH HÀNG</span><h2>Khách mua nhiều</h2></div></div>
          {!overviewReady ? <p className="merchant-overview-empty">Chưa tải được dữ liệu.</p> : !overview?.top_customers.length ? <p className="merchant-overview-empty">Chưa có khách hàng đặt đơn.</p> : <ol className="merchant-overview-ranking">{overview.top_customers.map((customer, index) => <li key={index}><span>{index + 1}</span><div><b>{customer.customer_name}</b><small>Khách đã đặt hàng</small></div><strong>{count(customer.order_count)} đơn</strong></li>)}</ol>}
          <p className="merchant-overview-caption">Xếp theo số đơn đã đặt, bao gồm đơn hủy; mỗi số điện thoại được tính là một khách.</p>
        </section>
      </div>

      <section className="merchant-quick-section">
        <div className="merchant-section-heading"><div><span>TIỆN ÍCH</span><h2>Thao tác nhanh</h2></div></div>
        <div className="merchant-shortcuts">
          <Link href="/dashboard/orders"><span className="merchant-shortcut-icon">↗</span><span className="merchant-shortcut-copy"><b>Quản lý đơn hàng</b><small>Xem đơn mới và cập nhật trạng thái</small></span><span className="merchant-shortcut-arrow">→</span></Link>
          <Link href="/dashboard/menu"><span className="merchant-shortcut-icon">☷</span><span className="merchant-shortcut-copy"><b>Cập nhật thực đơn</b><small>Thêm danh mục và chỉnh sửa món ăn</small></span><span className="merchant-shortcut-arrow">→</span></Link>
          <Link href="/dashboard/store"><span className="merchant-shortcut-icon">⌂</span><span className="merchant-shortcut-copy"><b>Thông tin cửa hàng</b><small>Địa chỉ, vị trí và website bán hàng</small></span><span className="merchant-shortcut-arrow">→</span></Link>
        </div>
      </section>

      <section className="admin-store-list merchant-recent-orders">
        <div className="admin-list-heading">
          <div><span className="merchant-section-eyebrow">CẬP NHẬT MỚI NHẤT</span><h2>Hoạt động gần đây</h2><p className="merchant-overview-caption">Các đơn hàng mới nhất của cửa hàng</p></div>
          <Link href="/dashboard/orders">Xem tất cả <span>→</span></Link>
        </div>
        {(latestOrders ?? []).map((order) => (
          <article className="admin-overview-store-row" key={order.id}>
            <div><b>{order.public_code}</b><span>{new Date(order.created_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} · {formatPrice(order.total_vnd)}</span></div>
            <span className={"status-badge status-" + order.status}>{orderStatusLabels[order.status] ?? order.status}</span>
          </article>
        ))}
        {latestOrdersError ? <div className="admin-empty" role="alert"><b>Chưa tải được đơn hàng gần đây</b><p>Vui lòng tải lại trang để thử lại.</p></div> : !latestOrders?.length && <div className="admin-empty"><span>↗</span><b>Chưa có đơn hàng</b><p>Đơn hàng của khách sẽ xuất hiện ở đây.</p></div>}
      </section>
    </main>
  );
}
