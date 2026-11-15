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
  ]);

  const storeRows = stores ?? [];
  const countByStatus = (status: string) => storeRows.filter((store) => store.status === status).length;

  return (
    <div className="admin-content">
      <div className="dashboard-kicker">TỔNG QUAN</div>
      <h1 className="admin-page-title">Xin chào, quản trị viên</h1>
      <p className="dashboard-intro">Theo dõi nhanh tình hình các cửa hàng trên nền tảng.</p>
      {storesError && <p className="admin-error" role="alert">Không đọc được danh sách cửa hàng. Kiểm tra quyền truy cập cơ sở dữ liệu.</p>}

      <div className="admin-stat-grid">
        <article><small>TỔNG CỬA HÀNG</small><b>{storeRows.length}</b></article>
        <article><small>CHỜ DUYỆT</small><b>{countByStatus("draft")}</b></article>
        <article><small>ĐANG HOẠT ĐỘNG</small><b>{countByStatus("active")}</b></article>
        <article><small>ĐÁNH GIÁ CHỜ DUYỆT</small><b>{pendingReviews ?? 0}</b></article>
        <article><small>TỔNG ĐƠN HÀNG</small><b>{totalOrders ?? 0}</b></article>
        <article><small>ĐƠN CHỜ XÁC NHẬN</small><b>{pendingOrders ?? 0}</b></article>
        <article><small>QR CHỜ CỬA HÀNG XÁC NHẬN</small><b>{pendingQrPayments ?? 0}</b></article>
      </div>

      <Link className="admin-orders-shortcut" href="/admin/orders">
        <span>▤</span><div><b>Giám sát đơn hàng toàn nền tảng</b><small>Xem trạng thái đơn, thanh toán QR, địa chỉ giao và cửa hàng phụ trách.</small></div><strong>→</strong>
      </Link>

      <section className="admin-store-list">
        <div className="admin-list-heading">
          <h2>Cửa hàng mới nhất</h2>
          <Link href="/admin/stores">Quản lý tất cả →</Link>
        </div>
        {storeRows.slice(0, 5).map((store) => (
          <article className="admin-overview-store-row" key={store.id}>
            <div><b>{store.name}</b><span>/{store.slug}</span></div>
            <span className={`status-badge status-${store.status}`}>{statusLabels[store.status] ?? store.status}</span>
          </article>
        ))}
        {!storeRows.length && <div className="admin-empty"><span>✳</span><b>Chưa có cửa hàng nào</b><p>Cửa hàng mới sẽ xuất hiện tại đây sau khi chủ quán đăng ký.</p></div>}
      </section>
    </div>
  );
}
