import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import Toast from "@/app/toast";
import { toastVariantForMessage } from "@/lib/toast";
import RemoveAdminDomainForm from "./remove-domain-form";

export const metadata: Metadata = { title: "Tên miền cửa hàng | Quản trị" };

const statusLabels: Record<string, string> = {
  pending: "Chờ xác minh",
  verified: "Đã xác minh",
  failed: "Cần cấu hình lại",
};

const messages: Record<string, string> = {
  "invalid-domain": "Yêu cầu gỡ tên miền không hợp lệ.",
  "domain-remove-failed": "Chưa gỡ được tên miền. Có thể tên miền đã bị gỡ ở nơi khác.",
  "domain-removed": "Đã gỡ tên miền khỏi cửa hàng.",
};

export default async function AdminDomainsPage({ searchParams }: PageProps<"/admin/domains">) {
  const query = await searchParams;
  const search = (typeof query.q === "string" ? query.q : "")
    .trim()
    .replace(/[<>"'`]/g, "")
    .slice(0, 100)
    .toLocaleLowerCase("vi-VN");
  const statuses = Object.keys(statusLabels);
  const filterStatus = typeof query.status === "string" && statuses.includes(query.status) ? query.status : "";

  const supabase = await createClient();
  const [{ data: domains, error }, { data: stores, error: storesError }] = await Promise.all([
    supabase
      .from("store_domains")
      .select("id, store_id, hostname, domain_type, verification_status, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("stores").select("id, name, slug, status"),
  ]);

  const storeById = new Map((stores ?? []).map((store) => [store.id, store]));
  const allDomains = domains ?? [];
  const filteredDomains = allDomains.filter((domain) => {
    const store = storeById.get(domain.store_id);
    const matchesStatus = !filterStatus || domain.verification_status === filterStatus;
    const searchText = `${domain.hostname} ${store?.name ?? ""} ${store?.slug ?? ""}`.toLocaleLowerCase("vi-VN");
    return matchesStatus && (!search || searchText.includes(search));
  });
  const message = typeof query.message === "string" ? messages[query.message] : undefined;
  const counts = {
    total: allDomains.length,
    pending: allDomains.filter((domain) => domain.verification_status === "pending").length,
    verified: allDomains.filter((domain) => domain.verification_status === "verified").length,
  };

  return (
    <div className="admin-content admin-domains-page">
      <div className="dashboard-kicker">QUẢN LÝ NỀN TẢNG</div>
      <h1 className="admin-page-title">Tên miền cửa hàng</h1>
      <p className="dashboard-intro">Theo dõi tên miền các cửa hàng, trạng thái xác minh và gỡ hostname không còn phù hợp.</p>
      <Toast message={message} variant={typeof query.message === "string" ? toastVariantForMessage(query.message) : "success"} />

      <div className="admin-domain-stats">
        <article><small>TỔNG TÊN MIỀN</small><b>{counts.total}</b></article>
        <article><small>CHỜ XÁC MINH</small><b>{counts.pending}</b></article>
        <article><small>ĐÃ XÁC MINH</small><b>{counts.verified}</b></article>
      </div>

      <form className="dashboard-form merchant-order-filters admin-order-filters" method="get">
        <label>Tìm tên miền hoặc cửa hàng<input type="search" name="q" maxLength={100} defaultValue={typeof query.q === "string" ? query.q : ""} placeholder="Hostname, tên quán hoặc slug" /></label>
        <label>Trạng thái<select name="status" defaultValue={filterStatus}>
          <option value="">Tất cả trạng thái</option>
          {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <div className="merchant-order-filter-actions">
          <button className="secondary-submit" type="submit">Lọc tên miền</button>
          {(search || filterStatus) && <Link href="/admin/domains">Xóa bộ lọc</Link>}
        </div>
      </form>

      <section className="admin-store-list admin-domain-list">
        <div className="admin-list-heading"><h2>Danh sách tên miền</h2><span>{filteredDomains.length} kết quả</span></div>
        {error || storesError ? (
          <p className="admin-error" role="alert">Không đọc được đầy đủ danh sách tên miền/cửa hàng. Kiểm tra migration 019 và quyền admin trong Supabase.</p>
        ) : filteredDomains.length ? filteredDomains.map((domain) => {
          const store = storeById.get(domain.store_id);
          return (
            <article className="admin-store-row admin-domain-row" key={domain.id}>
              <div className="admin-store-main">
                <div className="admin-store-title">
                  <b className="admin-domain-hostname">{domain.hostname}</b>
                  <span className={`status-badge domain-status-${domain.verification_status}`}>{statusLabels[domain.verification_status] ?? domain.verification_status}</span>
                </div>
                <div className="admin-domain-store">
                  {store ? <><b>{store.name}</b><span>/{store.slug}</span><span className={`status-badge status-${store.status}`}>{store.status}</span></> : <span>Không tìm thấy cửa hàng · ID {domain.store_id}</span>}
                </div>
                <div className="admin-store-meta">
                  <span>{domain.domain_type === "custom" ? "Tên miền riêng" : "Tên miền phụ"}</span>
                  <span>Đã thêm {new Date(domain.created_at).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</span>
                </div>
              </div>
              <div className="admin-store-actions">
                <RemoveAdminDomainForm domainId={domain.id} hostname={domain.hostname} />
              </div>
            </article>
          );
        }) : (
          <div className="admin-empty"><span>◎</span><b>{allDomains.length ? "Không có tên miền khớp bộ lọc" : "Chưa có tên miền nào"}</b><p>Tên miền cửa hàng sẽ xuất hiện tại đây sau khi được thêm trong dashboard.</p></div>
        )}
      </section>
    </div>
  );
}
