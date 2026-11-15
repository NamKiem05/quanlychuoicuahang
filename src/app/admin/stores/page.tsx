import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { updateStoreStatus } from "../actions";
import Toast from "@/app/toast";
import { toastVariantForMessage } from "@/lib/toast";

export const metadata: Metadata = { title: "Quản lý cửa hàng | Quản trị" };

const messages: Record<string, string> = {
  "invalid-status": "Trạng thái được chọn không hợp lệ.",
  "status-update-failed": "Chưa cập nhật được trạng thái cửa hàng.",
  "status-updated": "Đã cập nhật trạng thái cửa hàng.",
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
  const { data: stores, error } = await storesQuery;

  const storeRows = stores ?? [];
  const message = typeof query.message === "string" ? messages[query.message] : undefined;

  return (
    <div className="admin-content">
      <div className="dashboard-kicker">QUẢN LÝ</div>
      <h1 className="admin-page-title">Cửa hàng</h1>
      <p className="dashboard-intro">Duyệt gian hàng mới, tạm dừng hoặc khóa cửa hàng.</p>
      <Toast message={message} variant={typeof query.message === "string" ? toastVariantForMessage(query.message) : "success"} />
      {error && <p className="admin-error" role="alert">Không đọc được danh sách cửa hàng. Kiểm tra quyền truy cập cơ sở dữ liệu.</p>}

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

      <section className="admin-store-list">
        <div className="admin-list-heading"><h2>Cửa hàng</h2><span>{storeRows.length} kết quả</span></div>
        {storeRows.length ? storeRows.map((store) => (
          <article className="admin-store-row" key={store.id}>
            <div className="admin-store-main">
              <div className="admin-store-title"><b>{store.name}</b><span className={`status-badge status-${store.status}`}>{statusLabels[store.status] ?? store.status}</span></div>
              <span className="admin-store-slug">/{store.slug}</span>
              <div className="admin-store-meta">
                {store.address && <span>{store.address}</span>}
                {store.phone && <span>{store.phone}</span>}
                <span>Tạo ngày {new Date(store.created_at).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</span>
              </div>
            </div>
            <div className="admin-store-actions">
              {store.status !== "active" && <form action={updateStoreStatus}><input type="hidden" name="store_id" value={store.id} /><input type="hidden" name="filter_q" value={search} /><input type="hidden" name="filter_status" value={filterStatus} /><button className="approve-button" name="status" value="active" type="submit">{store.status === "draft" ? "Duyệt cửa hàng" : "Kích hoạt"}</button></form>}
              {store.status === "active" && <form action={updateStoreStatus}><input type="hidden" name="store_id" value={store.id} /><input type="hidden" name="filter_q" value={search} /><input type="hidden" name="filter_status" value={filterStatus} /><button className="quiet-action" name="status" value="paused" type="submit">Tạm dừng</button></form>}
              {store.status !== "suspended" && <form action={updateStoreStatus}><input type="hidden" name="store_id" value={store.id} /><input type="hidden" name="filter_q" value={search} /><input type="hidden" name="filter_status" value={filterStatus} /><button className="quiet-action danger-action" name="status" value="suspended" type="submit">Khóa</button></form>}
            </div>
          </article>
        )) : <div className="admin-empty"><span>✳</span><b>Chưa có cửa hàng nào</b><p>Cửa hàng mới sẽ xuất hiện tại đây sau khi chủ quán đăng ký.</p></div>}
      </section>
    </div>
  );
}
