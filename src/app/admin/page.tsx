import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Tổng quan quản trị | Bếp Nhà Mơ" };

const statusLabels: Record<string, string> = {
  draft: "Chờ duyệt",
  active: "Đang hoạt động",
  paused: "Tạm dừng",
  suspended: "Đã khóa",
};

export default async function AdminOverviewPage() {
  const supabase = await createClient();
  const [
    { data: stores, error: storesError },
    { count: pendingReviews },
    { count: totalOrders },
    { count: pendingOrders },
    { count: pendingQrPayments },
    { count: totalDomains },
    { count: pendingDomains },
  ] = await Promise.all([
    supabase
      .from("stores")
      .select("id, name, slug, status, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("reviews")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase.from("orders").select("id", { count: "exact", head: true }),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("payment_status", "awaiting_payment"),
    supabase.from("store_domains").select("id", { count: "exact", head: true }),
    supabase.from("store_domains").select("id", { count: "exact", head: true }).eq("verification_status", "pending"),
  ]);

  const storeRows = stores ?? [];
  const countByStatus = (status: string) => storeRows.filter((store) => store.status === status).length;

  return (
    <div className="admin-content admin-overview-page">
      <div className="admin-page-heading">
        <span className="admin-page-heading-icon" aria-hidden="true">▦</span>
        <div>
          <div className="dashboard-kicker">TỔNG QUAN NỀN TẢNG</div>
          <h1 className="admin-page-title">Tổng quan quản trị</h1>
          <p className="dashboard-intro">Theo dõi nhanh tình hình hoạt động của các cửa hàng.</p>
        </div>
      </div>
      {storesError && <p className="admin-error" role="alert">Không đọc được danh sách cửa hàng. Kiểm tra quyền truy cập cơ sở dữ liệu.</p>}

      <div className="admin-stat-grid admin-primary-stat-grid">
        <article className="admin-stat-blue"><span aria-hidden="true">⌂</span><div><small>TỔNG CỬA HÀNG</small><b>{storeRows.length}</b><em>Gian hàng trên nền tảng</em></div></article>
        <article className="admin-stat-green"><span aria-hidden="true">✓</span><div><small>ĐANG HOẠT ĐỘNG</small><b>{countByStatus("active")}</b><em>Cửa hàng đang nhận đơn</em></div></article>
        <article className="admin-stat-purple"><span aria-hidden="true">▤</span><div><small>TỔNG ĐƠN HÀNG</small><b>{totalOrders ?? 0}</b><em>Đơn từ tất cả cửa hàng</em></div></article>
        <article className="admin-stat-orange"><span aria-hidden="true">◷</span><div><small>CHỜ XÁC NHẬN</small><b>{pendingOrders ?? 0}</b><em>Đơn cần cửa hàng xử lý</em></div></article>
      </div>

      <div className="admin-secondary-stat-grid">
        <Link href="/admin/stores?status=draft"><span>CHỜ DUYỆT CỬA HÀNG</span><b>{countByStatus("draft")}</b><em>Xem cửa hàng mới →</em></Link>
        <Link href="/admin/reviews"><span>ĐÁNH GIÁ CHỜ DUYỆT</span><b>{pendingReviews ?? 0}</b><em>Quản lý đánh giá →</em></Link>
        <Link href="/admin/orders?payment_status=awaiting_payment"><span>QR CHỜ XÁC NHẬN</span><b>{pendingQrPayments ?? 0}</b><em>Kiểm tra thanh toán →</em></Link>
        <Link href="/admin/domains"><span>TÊN MIỀN CHỜ XÁC MINH</span><b>{pendingDomains ?? 0}</b><em>Quản lý tên miền →</em></Link>
      </div>

      <div className="admin-overview-panels">
        <section className="admin-store-list admin-overview-recent">
          <div className="admin-list-heading">
            <div><h2>Cửa hàng mới nhất</h2><p>Các gian hàng vừa tham gia nền tảng</p></div>
            <Link href="/admin/stores">Xem tất cả <span>→</span></Link>
          </div>
          {storeRows.slice(0, 5).map((store) => (
            <article className="admin-overview-store-row" key={store.id}>
              <div><b>{store.name}</b><span>/{store.slug}</span></div>
              <span className={`status-badge status-${store.status}`}>{statusLabels[store.status] ?? store.status}</span>
            </article>
          ))}
          {!storeRows.length && <div className="admin-empty"><span>✳</span><b>Chưa có cửa hàng nào</b><p>Cửa hàng mới sẽ xuất hiện tại đây sau khi chủ quán đăng ký.</p></div>}
        </section>

        <section className="admin-store-list admin-overview-health">
          <div className="admin-list-heading"><div><h2>Tình trạng cửa hàng</h2><p>Phân bố theo trạng thái hiện tại</p></div></div>
          {[
            { label: "Đang hoạt động", status: "active", color: "blue" },
            { label: "Chờ duyệt", status: "draft", color: "orange" },
            { label: "Tạm dừng", status: "paused", color: "gray" },
            { label: "Đã khóa", status: "suspended", color: "red" },
          ].map(({ label, status, color }) => {
            const count = countByStatus(status);
            const width = storeRows.length ? Math.round((count / storeRows.length) * 100) : 0;
            return <div className="admin-store-status-row" key={status}>
              <div><span className={`admin-status-dot ${color}`} /><span>{label}</span><b>{count}</b></div>
              <div className="admin-store-status-track"><span className={color} style={{ width: `${width}%` }} /></div>
            </div>;
          })}
          <div className="admin-health-footer"><span>{totalDomains ?? 0} tên miền đã đăng ký</span><Link href="/admin/domains">Quản lý tên miền →</Link></div>
        </section>
      </div>
    </div>
  );
}
