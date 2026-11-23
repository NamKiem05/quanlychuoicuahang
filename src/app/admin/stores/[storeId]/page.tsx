import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { findMerchantPlan } from "@/lib/merchant-plans";
import Toast from "@/components/ui/toast";
import { setStoreModule, resetStoreModule } from "../module-actions";
import "./store-detail.css";

export const metadata = { title: "Chi tiết cửa hàng | Quản trị" };
const statuses: Record<string, string> = { draft: "Chờ duyệt", active: "Đang hoạt động", paused: "Tạm dừng", suspended: "Đã khóa" };
const domainStatuses: Record<string, string> = { verified: "Đã xác minh", pending: "Chờ xác minh", failed: "Cần cấu hình lại" };
const dateFormat = new Intl.DateTimeFormat("vi-VN", { dateStyle: "long", timeZone: "Asia/Ho_Chi_Minh" });
const money = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" });
function date(value: string | null | undefined) { return value ? dateFormat.format(new Date(value)) : "Chưa có dữ liệu"; }
function count(value: number | null) { return value === null ? "—" : value.toLocaleString("vi-VN"); }
function isPlanActive(validUntil: string | null | undefined) { return Boolean(validUntil && Date.parse(validUntil) > Date.now()); }

export default async function AdminStoreDetail({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<{ message?: string }> }) {
  const [{ storeId }, query] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storeId)) notFound();
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const storeResult = await createAdminClient().from("stores").select("id, name, slug, description, phone, address, status, created_at, created_by, billing_owner_id").eq("id", storeId).maybeSingle();
  if (storeResult.error) return <main className="admin-content"><p className="admin-error" role="alert">Không tải được thông tin cửa hàng. Vui lòng thử lại.</p><Link href="/admin/stores">← Về danh sách cửa hàng</Link></main>;
  const store = storeResult.data;
  if (!store) notFound();

  const [modules, moduleSettings] = await Promise.all([supabase.from("platform_modules").select("code,name,description,default_enabled").order("name"), supabase.from("store_module_settings").select("module_code,enabled").eq("store_id", store.id)]);
  const moduleStates = await Promise.all((modules.data ?? []).map(async (module) => ({ code: module.code, result: await supabase.rpc("store_module_enabled", { target_store: store.id, target_module: module.code }) })));
  const [domains, members, staff, products, orders, revenue] = await Promise.all([
    supabase.from("store_domains").select("id, hostname, verification_status").eq("store_id", store.id).order("created_at"),
    supabase.from("store_members").select("user_id, role, created_at").eq("store_id", store.id).eq("role", "owner").order("created_at"),
    supabase.from("store_members").select("user_id", { count: "exact", head: true }).eq("store_id", store.id).eq("role", "staff"),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("store_id", store.id),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("store_id", store.id),
    supabase.rpc("get_admin_store_sales_revenue", { requested_store_id: store.id }),
  ]);
  const ownerId = (members.data ?? []).find((member) => member.role === "owner" && member.user_id === store.billing_owner_id)?.user_id
    ?? (members.data ?? []).find((member) => member.role === "owner")?.user_id ?? store.created_by;
  const [profile, plan] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", ownerId).maybeSingle(),
    store.billing_owner_id ? supabase.from("merchant_plan_payments").select("plan, paid_at, valid_until").eq("user_id", store.billing_owner_id).eq("status", "approved").order("valid_until", { ascending: false }).order("plan", { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  let email: string | null = null;
  let emailUnavailable = false;
  try {
    const result = await createAdminClient().auth.admin.getUserById(ownerId);
    emailUnavailable = Boolean(result.error);
    email = result.data?.user?.email ?? null;
  } catch { emailUnavailable = true; }
  const planRow = plan.data;
  const planActive = isPlanActive(planRow?.valid_until);
  const planName = !store.billing_owner_id ? "Cửa hàng chưa liên kết gói" : planRow ? findMerchantPlan(planRow.plan)?.name ?? planRow.plan : "Chưa có gói đã thanh toán";
  const fields = [
    { label: "Mã cửa hàng", value: store.id },
    { label: "Đường dẫn cửa hàng", value: `/${store.slug}` },
    { label: "Ngày đăng ký", value: date(store.created_at) },
    { label: "Số điện thoại", value: store.phone || "Chưa cập nhật" },
    { label: "Địa chỉ", value: store.address || "Chưa cập nhật" },
    { label: "Chủ sở hữu", value: profile.error || members.error ? "Không tải được thông tin" : profile.data?.display_name || "Chưa cập nhật tên" },
    { label: "Email liên hệ", value: emailUnavailable ? "Không tải được email tài khoản chủ sở hữu" : email || "Chưa cập nhật email" },
  ];
  return <main className="admin-content store-detail">
    <Toast message={query.message === "updated" ? "Đã cập nhật thông tin cửa hàng." : query.message === "module-updated" ? "Đã cập nhật module cửa hàng." : query.message === "module-failed" ? "Chưa cập nhật được module." : undefined} />
    <Link className="store-detail-back" href="/admin/stores">← Danh sách cửa hàng</Link>
    <header className="store-detail-hero">
      <div className="store-detail-avatar" aria-hidden="true">{store.name.trim().charAt(0).toLocaleUpperCase("vi-VN")}</div>
      <div className="store-detail-identity"><span>HỒ SƠ CỬA HÀNG</span><h1>{store.name}</h1><p>/{store.slug} <span className={`status-badge status-${store.status}`}>{statuses[store.status] ?? store.status}</span></p></div>
      <Link className="store-detail-view" href={`/${store.slug}`} target="_blank" rel="noopener noreferrer">Xem trang cửa hàng ↗</Link>
    </header>
    <section className="store-detail-stats" aria-label="Số liệu cửa hàng">
      <article><span>Sản phẩm</span><strong>{count(products.count)}</strong><small>{products.error ? "Không tải được dữ liệu" : "Tổng sản phẩm"}</small></article>
      <article><span>Đơn hàng</span><strong>{count(orders.count)}</strong><small>{orders.error ? "Không tải được dữ liệu" : "Tổng đơn hàng"}</small></article>
      <article><span>Nhân viên</span><strong>{count(staff.count)}</strong><small>{staff.error ? "Không tải được dữ liệu" : "Không tính chủ sở hữu"}</small></article>
      <article><span>Doanh thu bán hàng</span><strong>{revenue.error || revenue.data === null ? "—" : money.format(Number(revenue.data))}</strong><small>{revenue.error ? "Chưa tải được doanh thu" : "Đơn đã thanh toán, không tính đơn hủy / từ chối"}</small></article>
    </section>
    {revenue.error && <p className="admin-error" role="alert">Chưa tải được doanh thu. Kiểm tra migration 202611180003_admin_store_revenue.sql và quyền truy cập.</p>}
    <section className="store-detail-card store-module-panel"><div className="store-detail-card-heading"><div><h2>Module cửa hàng</h2><p>Bật hoặc tắt chức năng cho cửa hàng này.</p></div><span aria-hidden="true">▦</span></div>{modules.error || moduleSettings.error || moduleStates.some((state) => state.result.error) ? <p role="alert">Chưa tải được module. Cần chạy migration 202611180036_store_modules.sql.</p> : modules.data?.map((module) => { const explicit = moduleSettings.data?.find((row) => row.module_code === module.code); const enabled = moduleStates.find((state) => state.code === module.code)?.result.data === true; return <div className="store-module-row" key={module.code}><div><b>{module.name}</b><p>{module.description}</p></div><span>{enabled ? "Đang bật" : "Đã tắt"} · {explicit ? "Riêng cửa hàng" : "Theo ngành hàng"}</span><form action={setStoreModule}><input type="hidden" name="store_id" value={store.id} /><input type="hidden" name="module" value={module.code} /><input type="hidden" name="enabled" value={String(!enabled)} /><button type="submit">{enabled ? "Tắt module" : "Bật module"}</button></form>{explicit && <form action={resetStoreModule}><input type="hidden" name="store_id" value={store.id} /><input type="hidden" name="module" value={module.code} /><button type="submit">Theo ngành hàng</button></form>}</div>; })}</section>
    <div className="store-detail-grid">
      <section className="store-detail-card"><div className="store-detail-card-heading"><div><h2>Thông tin cửa hàng</h2><p>Thông tin đăng ký và liên hệ</p></div><span aria-hidden="true">⌂</span></div>
        <dl className="store-detail-fields">{fields.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>
        {store.description && <div className="store-detail-description"><b>Giới thiệu</b><p>{store.description}</p></div>}
      </section>
      <div className="store-detail-side">
        <section className="store-detail-card"><div className="store-detail-card-heading"><div><h2>Gói dịch vụ</h2><p>Thông tin gói của chủ thanh toán</p></div><span aria-hidden="true">◇</span></div>
          {plan.error ? <p className="store-detail-muted">Không tải được thông tin gói.</p> : <><div className="store-detail-plan"><strong>{planName}</strong>{planRow && <span className={planActive ? "is-active" : "is-expired"}>{planActive ? "Còn hiệu lực" : "Đã hết hạn"}</span>}</div>
            <dl className="store-detail-fields store-detail-plan-fields"><div><dt>Thanh toán gần nhất</dt><dd>{date(planRow?.paid_at)}</dd></div><div><dt>Ngày hết hạn</dt><dd>{date(planRow?.valid_until)}</dd></div><div><dt>Ngày bắt đầu sử dụng</dt><dd>Chưa được lưu riêng</dd></div></dl></>}
        </section>
        <section className="store-detail-card"><div className="store-detail-card-heading"><div><h2>Tên miền</h2><p>Tên miền đã đăng ký cho cửa hàng</p></div><span aria-hidden="true">◎</span></div>
          {domains.error ? <p className="store-detail-muted">Không tải được tên miền.</p> : domains.data?.length ? <ul className="store-detail-domains">{domains.data.map((domain) => <li key={domain.id}><span>{domain.hostname}</span><small>{domainStatuses[domain.verification_status] ?? domain.verification_status}</small></li>)}</ul> : <p className="store-detail-muted">Chưa có tên miền được đăng ký.</p>}
          <Link className="store-detail-text-link" href="/admin/domains">Quản lý tên miền →</Link>
        </section>
      </div>
    </div>
  </main>;
}
