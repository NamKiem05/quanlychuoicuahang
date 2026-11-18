import Link from "next/link";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { findMerchantPlan } from "@/lib/merchant-plans";
import "./subscriptions.css";

export const metadata = { title: "Đăng ký dịch vụ | Quản trị" };
const pageSize = 25;
const dateFormatter = new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeZone: "Asia/Ho_Chi_Minh" });
function date(value: string | null | undefined) { return value ? dateFormatter.format(new Date(value)) : "—"; }
function isActive(value: string | null | undefined) { return Boolean(value && Date.parse(value) > Date.now()); }

export default async function Subscriptions({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await connection();
  const [supabase, query] = await Promise.all([createClient(), searchParams]);
  await requirePlatformAdminAccess(supabase);
  const search = typeof query.q === "string" ? query.q.trim().replace(/[^\p{L}\p{N}\s.-]/gu, "").slice(0, 60) : "";
  const page = typeof query.page === "string" && /^[1-9]\d{0,5}$/.test(query.page) ? Number(query.page) : 1;
  const start = (page - 1) * pageSize;
  let request = createAdminClient().from("stores").select("id, name, slug, billing_owner_id", { count: "exact" }).order("created_at", { ascending: false }).order("id").range(start, start + pageSize - 1);
  if (search) request = request.or(`name.ilike.%${search}%,slug.ilike.%${search}%`);
  const stores = await request;
  const rows = await Promise.all((stores.data ?? []).map(async (store) => {
    if (!store.billing_owner_id) return { store, payment: null, error: false };
    const result = await supabase.from("merchant_plan_payments").select("plan, paid_at, valid_until").eq("user_id", store.billing_owner_id).eq("status", "approved").order("valid_until", { ascending: false }).order("plan", { ascending: false }).order("id").limit(1).maybeSingle();
    return { store, payment: result.data, error: Boolean(result.error) };
  }));
  function pageHref(next: number) { const params = new URLSearchParams({ page: String(next) }); if (search) params.set("q", search); return `/admin/subscriptions?${params}`; }
  return <main className="admin-content subscriptions-page">
    <header className="subscriptions-heading"><span aria-hidden="true">◈</span><div><div className="dashboard-kicker">QUẢN LÝ KINH DOANH</div><h1 className="admin-page-title">Đăng ký dịch vụ</h1><p>Theo dõi gói và lịch sử thanh toán của từng cửa hàng.</p></div><Link href="/admin/plan-payments">Xem giao dịch →</Link></header>
    <div className="subscriptions-note"><strong>Dữ liệu hiện có</strong><p>Trạng thái được tính từ giao dịch đã xác nhận và hạn gói. Ngày bắt đầu chưa được lưu riêng. Các tài khoản chưa tạo cửa hàng xem tại mục Thanh toán & giao dịch.</p></div>
    <form className="subscriptions-filter" method="get"><label>Tìm cửa hàng<input type="search" name="q" defaultValue={search} maxLength={60} placeholder="Tên hoặc đường dẫn cửa hàng" /></label><button type="submit">Tìm kiếm</button>{search && <Link href="/admin/subscriptions">Xóa lọc</Link>}</form>
    <section className="subscriptions-panel"><div className="subscriptions-panel-heading"><div><h2>Danh sách cửa hàng</h2><p>Chọn cửa hàng để xem lịch sử gói và giao dịch.</p></div>{!stores.error && <span>{(stores.count ?? 0).toLocaleString("vi-VN")} cửa hàng</span>}</div>
      {stores.error ? <p className="subscriptions-empty" role="alert">Không tải được danh sách. Kiểm tra quyền truy cập và migration gói dịch vụ.</p> : rows.length === 0 ? <p className="subscriptions-empty">Không tìm thấy cửa hàng phù hợp.</p> : <div className="subscriptions-scroll"><table><thead><tr><th>Cửa hàng</th><th>Gói gần nhất</th><th>Trạng thái</th><th>Thanh toán gần nhất</th><th>Ngày hết hạn</th><th /></tr></thead><tbody>{rows.map(({ store, payment, error }) => {
        const state = error ? "Không tải được" : !store.billing_owner_id ? "Chưa liên kết" : !payment ? "Chưa có gói" : isActive(payment.valid_until) ? "Còn hiệu lực" : "Hết hạn";
        return <tr key={store.id}><td><Link className="subscriptions-store" href={`/admin/stores/${store.id}`}>{store.name}</Link><small>/{store.slug}</small></td><td>{error ? "—" : payment ? findMerchantPlan(payment.plan)?.name ?? payment.plan : "—"}</td><td><span className={`subscriptions-status ${state === "Còn hiệu lực" ? "is-active" : state === "Hết hạn" ? "is-expired" : ""}`}>{state}</span></td><td>{date(payment?.paid_at)}</td><td>{date(payment?.valid_until)}</td><td><Link className="subscriptions-link" href={`/admin/subscriptions/${store.id}`}>Chi tiết →</Link></td></tr>;
      })}</tbody></table></div>}
      {!stores.error && (page > 1 || start + pageSize < (stores.count ?? 0)) && <nav className="subscriptions-pagination" aria-label="Phân trang đăng ký">{page > 1 && <Link href={pageHref(page - 1)}>← Trang trước</Link>}<span>Trang {page}</span>{start + pageSize < (stores.count ?? 0) && <Link href={pageHref(page + 1)}>Trang sau →</Link>}</nav>}
    </section>
  </main>;
}
