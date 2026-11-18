import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import StoreActions from "./store-actions";
import Toast from "@/app/toast";
import { toastVariantForMessage } from "@/lib/toast";
import "./store-stats.css";

export const metadata: Metadata = { title: "Quản lý cửa hàng | Quản trị" };

const messages: Record<string, string> = {
  "invalid-status": "Trạng thái được chọn không hợp lệ.",
  "status-update-failed": "Chưa cập nhật được trạng thái cửa hàng.",
  "status-updated": "Đã cập nhật trạng thái cửa hàng.",
  "store-deleted": "Đã xóa cửa hàng và lưu lịch sử thao tác.",
};

const statusLabels: Record<string, string> = {
  draft: "Chờ duyệt",
  active: "Đang hoạt động",
  paused: "Tạm dừng",
  suspended: "Đã khóa",
};

export default async function AdminStoresPage({ searchParams }: PageProps<"/admin/stores">) {
  const query = await searchParams;
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const search = (typeof query.q === "string" ? query.q : "")
    .trim()
    .replace(/[^\p{L}\p{N}\s+.-]/gu, "")
    .slice(0, 60)
    .trim();
  const validStatuses = Object.keys(statusLabels);
  const filterStatus = typeof query.status === "string" && validStatuses.includes(query.status) ? query.status : "";
  let storesQuery = supabase
    .from("stores")
    .select("id, name, slug, status, phone, address, created_at")
    .order("created_at", { ascending: false });
  if (search) storesQuery = storesQuery.or(`name.ilike.%${search}%,slug.ilike.%${search}%,phone.ilike.%${search}%`);
  if (filterStatus) storesQuery = storesQuery.eq("status", filterStatus);
  const [storesResult, ...stats] = await Promise.all([
    storesQuery,
    supabase.from("stores").select("id", { count: "exact", head: true }),
    ...validStatuses.map((status) => supabase.from("stores").select("id", { count: "exact", head: true }).eq("status", status)),
  ]);
  const { data: stores, error } = storesResult;

  const storeRows = stores ?? [];
  const message = typeof query.message === "string" ? messages[query.message] : undefined;

  return (
    <div className="admin-content">
      <div className="dashboard-kicker">QUẢN LÝ</div>
      <h1 className="admin-page-title">Cửa hàng</h1>
      <p className="dashboard-intro">Duyệt gian hàng mới, tạm dừng hoặc khóa cửa hàng.</p>
      <Toast message={message} variant={typeof query.message === "string" ? toastVariantForMessage(query.message) : "success"} />
      {error && <p className="admin-error" role="alert">Không đọc được danh sách cửa hàng. Kiểm tra quyền truy cập cơ sở dữ liệu.</p>}

      <section className="admin-store-statistics" aria-label="Thống kê cửa hàng toàn hệ thống">
        {[
          { label: "Tổng cửa hàng", status: "", icon: "▦", tone: "blue", result: stats[0] },
          { label: "Chờ duyệt", status: "draft", icon: "◷", tone: "orange", result: stats[1] },
          { label: "Đang hoạt động", status: "active", icon: "✓", tone: "green", result: stats[2] },
          { label: "Tạm dừng", status: "paused", icon: "Ⅱ", tone: "purple", result: stats[3] },
          { label: "Đã khóa", status: "suspended", icon: "⊘", tone: "red", result: stats[4] },
        ].map(({ label, status, icon, tone, result }) => <Link className={`admin-store-stat is-${tone}`} href={status ? `/admin/stores?status=${status}` : "/admin/stores"} key={label} aria-current={filterStatus === status && !search ? "true" : undefined}>
          <span className="admin-store-stat-icon" aria-hidden="true">{icon}</span><span className="admin-store-stat-copy"><small>{label}</small><strong>{result.error || result.count === null ? "—" : result.count.toLocaleString("vi-VN")}</strong><span>{result.error ? "Không tải được số liệu" : "Toàn hệ thống"}</span></span>
        </Link>)}
      </section>

      <form className="dashboard-form merchant-order-filters admin-order-filters" method="get">
        <label>Tìm cửa hàng<input type="search" name="q" maxLength={60} defaultValue={search} placeholder="Tên, đường dẫn hoặc số điện thoại" /></label>
        <label>Trạng thái<select name="status" defaultValue={filterStatus}>
          <option value="">Tất cả trạng thái</option>
          {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <div className="merchant-order-filter-actions">
          <button className="secondary-submit" type="submit">Lọc cửa hàng</button>
          {(search || filterStatus) && <Link href="/admin/stores">Xóa bộ lọc</Link>}
        </div>
      </form>

      <section className="admin-store-list admin-stores-list">
        <div className="admin-list-heading"><h2>Cửa hàng</h2><span>{storeRows.length} kết quả</span></div>
        {storeRows.length ? storeRows.map((store) => (
          <article className="admin-store-row" key={store.id}>
            <div className="admin-store-main">
              <div className="admin-store-title"><Link href={`/admin/stores/${store.id}`}><b>{store.name}</b></Link><span className={`status-badge status-${store.status}`}>{statusLabels[store.status] ?? store.status}</span></div>
              <span className="admin-store-slug">/{store.slug}</span>
              <div className="admin-store-meta">
                {store.address && <span>{store.address}</span>}
                {store.phone && <span>{store.phone}</span>}
                <span>Tạo ngày {new Date(store.created_at).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</span>
              </div>
            </div>
            <StoreActions storeId={store.id} storeName={store.name} status={store.status} search={search} filterStatus={filterStatus} />
          </article>
        )) : <div className="admin-empty"><span>✳</span><b>Chưa có cửa hàng nào</b><p>Cửa hàng mới sẽ xuất hiện tại đây sau khi chủ quán đăng ký.</p></div>}
      </section>
    </div>
  );
}
