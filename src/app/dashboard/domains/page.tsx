import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Toast from "@/app/toast";
import { toastVariantForMessage } from "@/lib/toast";
import { getMerchantContext } from "../data";
import { requireMerchantPremium } from "@/lib/merchant-billing";
import { addStoreCustomDomain, removeStoreCustomDomain, verifyStoreCustomDomain } from "../actions";

export const metadata: Metadata = { title: "Tên miền | Quản lý cửa hàng" };

const messages: Record<string, string> = {
  "owner-required": "Chỉ chủ cửa hàng mới có thể quản lý tên miền.",
  "invalid-domain": "Tên miền chưa hợp lệ. Hãy nhập dạng shop.example.com, không thêm https:// hoặc đường dẫn.",
  "domain-taken": "Tên miền này đã được một cửa hàng khác đăng ký.",
  "domain-add-failed": "Chưa thêm được tên miền. Hãy tải lại trang và thử lại.",
  "domain-added": "Đã thêm tên miền. Hãy cấu hình đủ bản ghi DNS bên dưới rồi xác minh.",
  "domain-not-found": "Không tìm thấy tên miền trong cửa hàng này.",
  "domain-target-not-configured": "Quản trị viên cần cấu hình STORE_DOMAIN_CNAME_TARGET trước khi xác minh tên miền.",
  "domain-service-key-missing": "Máy chủ chưa cấu hình SUPABASE_SERVICE_ROLE_KEY để cập nhật trạng thái xác minh.",
  "domain-dns-pending": "Chưa tìm thấy đủ bản ghi DNS. Hãy kiểm tra lại DNS rồi đợi cập nhật trước khi xác minh lần nữa.",
  "domain-verify-failed": "DNS đã đúng nhưng chưa cập nhật được trạng thái. Hãy thử lại sau.",
  "domain-verified": "Tên miền đã được xác minh. Hãy chờ nhà cung cấp hosting cấp HTTPS và chuyển lưu lượng về ứng dụng.",
  "domain-already-verified": "Tên miền này đã xác minh.",
  "domain-remove-failed": "Chưa gỡ được tên miền. Hãy thử lại.",
  "domain-removed": "Đã gỡ tên miền khỏi cửa hàng.",
};

function prettyHost(value: string) {
  return value.trim().replace(/^https?:\/\//i, "").split(/[/?#]/)[0].replace(/:\d+$/, "").toLowerCase();
}

function statusLabel(status: string) {
  if (status === "verified") return "Đã xác minh";
  if (status === "failed") return "Cần cấu hình lại";
  return "Chờ xác minh";
}

export default async function StoreDomainsPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const [{ supabase, membership, store }, query] = await Promise.all([getMerchantContext(), searchParams]);
  if (!store || !membership) redirect("/dashboard");
  if (membership.role !== "owner") redirect("/dashboard/store?message=owner-required");
  await requireMerchantPremium(supabase, store.id);

  const { data: domains, error } = await supabase
    .from("store_domains")
    .select("id, hostname, domain_type, verification_status, verification_token, created_at")
    .eq("store_id", store.id)
    .eq("domain_type", "custom")
    .order("created_at", { ascending: true });
  const platformDomain = prettyHost(process.env.NEXT_PUBLIC_PLATFORM_DOMAIN ?? "");
  const cnameTarget = prettyHost(process.env.STORE_DOMAIN_CNAME_TARGET ?? "");
  const message = query.message ? messages[query.message] : undefined;

  return (
    <main className="admin-content merchant-dashboard domains-page">
      <div className="merchant-dashboard-heading">
        <div>
          <div className="dashboard-kicker"><span className="dashboard-live-dot" /> ĐỊA CHỈ WEBSITE</div>
          <h1 className="admin-page-title">Tên miền cửa hàng</h1>
          <p className="dashboard-intro">Dùng địa chỉ phụ của nền tảng hoặc kết nối tên miền riêng của cửa hàng.</p>
        </div>
        <a className="merchant-heading-action" href={`/${store.slug}`} target="_blank" rel="noreferrer">Xem website <span>↗</span></a>
      </div>
      <Toast message={message} variant={query.message ? toastVariantForMessage(query.message) : "success"} />

      <section className="dashboard-card domains-card">
        <div className="dashboard-card-heading">
          <div><span className="dashboard-card-icon">◎</span><h2>Địa chỉ trên nền tảng</h2></div>
          <p>Được tạo tự động từ đường dẫn cửa hàng.</p>
        </div>
        <div className="domain-platform-address">
          <div><span>Đường dẫn hiện tại</span><code>/{store.slug}</code></div>
          {platformDomain ? (
            <div><span>Tên miền phụ</span><a href={`https://${store.slug}.${platformDomain}`} target="_blank" rel="noreferrer">https://{store.slug}.{platformDomain} ↗</a></div>
          ) : (
            <p className="dashboard-help">Tên miền phụ chưa được bật. Quản trị viên cần trỏ wildcard DNS và cấu hình <code>NEXT_PUBLIC_PLATFORM_DOMAIN</code>; hiện khách có thể truy cập qua đường dẫn <code>/{store.slug}</code>.</p>
          )}
        </div>
      </section>

      <div className="domain-custom-grid">
        <section className="dashboard-card domains-card">
          <div className="dashboard-card-heading">
            <div><span className="dashboard-card-icon">＋</span><h2>Kết nối tên miền riêng</h2></div>
            <p>Ví dụ: monngon.example.com</p>
          </div>
          <form action={addStoreCustomDomain} className="dashboard-form">
            <label htmlFor="custom-hostname">Tên miền
              <input id="custom-hostname" name="hostname" type="text" autoComplete="off" placeholder="monngon.example.com" maxLength={253} required />
            </label>
            <p className="dashboard-help">Nên dùng tên miền phụ như <code>www.example.com</code>. Tên miền gốc thường không hỗ trợ bản ghi CNAME.</p>
            <button className="dashboard-submit merchant-domain-button" type="submit">Thêm tên miền <span>→</span></button>
          </form>
        </section>

        <section className="dashboard-card domains-card domain-setup-card">
          <div className="dashboard-card-heading">
            <div><span className="dashboard-card-icon">⌁</span><h2>Trạng thái cấu hình</h2></div>
            <p>DNS xác minh quyền sở hữu và trỏ về ứng dụng.</p>
          </div>
          <ol className="domain-setup-steps">
            <li>Thêm tên miền ở đây để nhận mã xác minh riêng.</li>
            <li>Tạo bản ghi TXT và CNAME theo hướng dẫn dưới từng tên miền.</li>
            <li>Sau khi xác minh, thêm hostname vào cấu hình domain của nhà cung cấp hosting để bật HTTPS.</li>
          </ol>
          {!cnameTarget && <p className="domain-config-warning">Quản trị viên cần đặt <code>STORE_DOMAIN_CNAME_TARGET</code> trong cấu hình máy chủ để hiển thị đích CNAME.</p>}
        </section>
      </div>

      <section className="dashboard-card domains-card domain-list-card">
        <div className="dashboard-card-heading">
          <div><span className="dashboard-card-icon">⌂</span><h2>Tên miền riêng</h2></div>
          <p>{domains?.length ?? 0} tên miền đã thêm</p>
        </div>
        {error ? (
          <div className="domain-empty-state">
            <b>Chưa tải được cấu hình tên miền</b>
            <p>Hãy chạy migration <code>202611150007_store_domain_verification.sql</code> trong Supabase rồi tải lại trang.</p>
          </div>
        ) : domains?.length ? (
          <div className="domain-list">
            {domains.map((domain) => (
              <article className="domain-item" key={domain.id}>
                <div className="domain-item-heading">
                  <div className="domain-item-title"><b>{domain.hostname}</b><span className={`domain-status domain-status-${domain.verification_status}`}>{statusLabel(domain.verification_status)}</span></div>
                  <form action={removeStoreCustomDomain}>
                    <input type="hidden" name="domain_id" value={domain.id} />
                    <button className="domain-remove-button" type="submit">Gỡ tên miền</button>
                  </form>
                </div>
                <div className="domain-records">
                  <div><span>CNAME · Tên</span><code>{domain.hostname}</code></div>
                  <div><span>CNAME · Giá trị</span><code>{cnameTarget || "Chờ quản trị viên cấu hình"}</code></div>
                  <div><span>TXT · Tên</span><code>_foodgo-verification.{domain.hostname}</code></div>
                  <div><span>TXT · Giá trị</span><code>foodgo-verify={domain.verification_token}</code></div>
                </div>
                <div className="domain-item-footer">
                  <p className="dashboard-help">DNS có thể mất một lúc để cập nhật. Tên miền chỉ mở storefront sau khi xác minh và hosting đã gắn hostname này.</p>
                  {domain.verification_status !== "verified" && (
                    <form action={verifyStoreCustomDomain}>
                      <input type="hidden" name="domain_id" value={domain.id} />
                      <button className="merchant-domain-button" type="submit">Kiểm tra DNS</button>
                    </form>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="domain-empty-state">
            <b>Chưa có tên miền riêng</b>
            <p>Thêm một hostname ở trên để hệ thống tạo hướng dẫn DNS và mã xác minh.</p>
          </div>
        )}
      </section>
    </main>
  );
}
