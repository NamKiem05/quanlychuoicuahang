import type { Metadata } from "next";
import Link from "next/link";
import { createStore } from "./actions";
import { dashboardMessages, formatPrice, getMerchantContext, orderStatusLabels } from "./data";

export const metadata: Metadata = { title: "Tổng quan cửa hàng | Bếp Nhà Mơ" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const [{ supabase, store }, query] = await Promise.all([getMerchantContext(), searchParams]);
  const message = query.message ? dashboardMessages[query.message] : undefined;

  if (!store) {
    return (
      <main className="admin-content">
        <div className="dashboard-kicker">KHU VỰC CHỦ CỬA HÀNG</div>
        <h1 className="admin-page-title">Tạo gian hàng đầu tiên</h1>
        <p className="dashboard-intro">Tạo trang bán hàng riêng để bắt đầu đăng món và nhận đơn.</p>
        {message && <p className="dashboard-message" role="status">{message}</p>}
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
            <div className="form-row coordinate-row">
              <label>Vĩ độ <span className="field-hint">Tùy chọn</span><input name="latitude" type="number" step="any" min="-90" max="90" placeholder="10.7769" /></label>
              <label>Kinh độ <span className="field-hint">Tùy chọn</span><input name="longitude" type="number" step="any" min="-180" max="180" placeholder="106.7009" /></label>
            </div>
            <p className="dashboard-help">Thêm tọa độ để khách tìm thấy cửa hàng trong bán kính 5 km. Có thể bổ sung sau.</p>
            <button className="primary-button dashboard-submit" type="submit">Tạo gian hàng <span>→</span></button>
          </form>
        </section>
      </main>
    );
  }

  const [
    { count: productCount },
    { count: pendingOrderCount },
    { count: pendingReviewCount },
    { data: latestOrders },
  ] = await Promise.all([
    supabase.from("products").select("id", { count: "exact", head: true }).eq("store_id", store.id).neq("status", "archived"),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("store_id", store.id).eq("status", "pending"),
    supabase.from("reviews").select("id", { count: "exact", head: true }).eq("store_id", store.id).eq("status", "pending"),
    supabase.from("orders").select("id, public_code, status, total_vnd, created_at").eq("store_id", store.id).order("created_at", { ascending: false }).limit(5),
  ]);

  return (
    <main className="admin-content merchant-dashboard">
      <div className="merchant-dashboard-heading">
        <div>
          <div className="dashboard-kicker"><span className="dashboard-live-dot" /> TỔNG QUAN CỬA HÀNG</div>
          <h1 className="admin-page-title">Xin chào, {store.name}</h1>
          <p className="dashboard-intro">Cùng xem nhanh tình hình hoạt động của cửa hàng hôm nay.</p>
        </div>
        <Link className="merchant-heading-action" href="/dashboard/orders">Quản lý đơn hàng <span>→</span></Link>
      </div>
      {message && <p className="dashboard-message" role="status">{message}</p>}

      <section className="merchant-store-banner">
        <div className="merchant-store-banner-copy">
          <span className="merchant-banner-label">GIAN HÀNG CỦA BẠN</span>
          <b>{store.name}</b>
          <span className="merchant-store-url">/{store.slug}</span>
        </div>
        <div className="merchant-store-banner-actions">
          <span className={"status-badge status-" + store.status}>{store.status === "active" ? "Đang hoạt động" : store.status === "suspended" ? "Đã tạm dừng" : "Chờ duyệt"}</span>
          {store.status === "active" && <a className="store-preview-link" href={"/" + store.slug}>Xem website ↗</a>}
        </div>
        <span className="merchant-store-banner-art" aria-hidden="true">✳</span>
      </section>
      {store.status !== "active" && <p className="dashboard-help approval-note">Gian hàng đang ở trạng thái bản nháp. Cần admin nền tảng duyệt trước khi hiển thị công khai.</p>}

      <div className="admin-stat-grid merchant-stat-grid">
        <article className="merchant-stat-card merchant-stat-products">
          <span className="merchant-stat-icon" aria-hidden="true">☷</span>
          <div><small>MÓN ĐANG QUẢN LÝ</small><b>{productCount ?? 0}</b><span>Món trong thực đơn</span></div>
          <Link href="/dashboard/menu" aria-label="Mở thực đơn">↗</Link>
        </article>
        <article className="merchant-stat-card merchant-stat-orders">
          <span className="merchant-stat-icon" aria-hidden="true">↗</span>
          <div><small>ĐƠN CHỜ XÁC NHẬN</small><b>{pendingOrderCount ?? 0}</b><span>Đơn mới cần xử lý</span></div>
          <Link href="/dashboard/orders" aria-label="Mở đơn hàng">↗</Link>
        </article>
        <article className="merchant-stat-card merchant-stat-reviews">
          <span className="merchant-stat-icon" aria-hidden="true">★</span>
          <div><small>ĐÁNH GIÁ CHỜ DUYỆT</small><b>{pendingReviewCount ?? 0}</b><span>Phản hồi khách hàng</span></div>
          <Link href="/dashboard/reviews" aria-label="Mở đánh giá">↗</Link>
        </article>
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
          <div><span className="merchant-section-eyebrow">CẬP NHẬT MỚI NHẤT</span><h2>Đơn hàng gần đây</h2></div>
          <Link href="/dashboard/orders">Xem tất cả <span>→</span></Link>
        </div>
        {(latestOrders ?? []).map((order) => (
          <article className="admin-overview-store-row" key={order.id}>
            <div><b>{order.public_code}</b><span>{new Date(order.created_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} · {formatPrice(order.total_vnd)}</span></div>
            <span className={"status-badge status-" + order.status}>{orderStatusLabels[order.status] ?? order.status}</span>
          </article>
        ))}
        {!latestOrders?.length && <div className="admin-empty"><span>↗</span><b>Chưa có đơn hàng</b><p>Đơn hàng của khách sẽ xuất hiện ở đây.</p></div>}
      </section>
    </main>
  );
}
