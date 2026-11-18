import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { findMerchantPlan, formatPlanAmount } from "@/lib/merchant-plans";
import "../subscriptions.css";

const dateFormatter = new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
function date(value: string | null | undefined) { return value ? dateFormatter.format(new Date(value)) : "—"; }
function isActive(value: string | null | undefined) { return Boolean(value && Date.parse(value) > Date.now()); }
const statuses: Record<string, string> = { pending: "Chờ thanh toán", approved: "Đã xác nhận", expired: "Hết hạn", cancelled: "Đã hủy yêu cầu", needs_review: "Cần đối soát" };
const pageSize = 25;

export default async function SubscriptionDetail({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<{ page?: string }> }) {
  await connection();
  const [{ storeId }, query, supabase] = await Promise.all([params, searchParams, createClient()]);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storeId)) notFound();
  await requirePlatformAdminAccess(supabase);
  const storeResult = await createAdminClient().from("stores").select("id, name, slug, billing_owner_id").eq("id", storeId).maybeSingle();
  if (storeResult.error) return <main className="admin-content"><p className="admin-error">Không tải được cửa hàng.</p><Link href="/admin/subscriptions">← Danh sách đăng ký</Link></main>;
  const store = storeResult.data;
  if (!store) notFound();
  const page = typeof query.page === "string" && /^[1-9]\d{0,5}$/.test(query.page) ? Number(query.page) : 1;
  const start = (page - 1) * pageSize;
  const [current, history] = store.billing_owner_id ? await Promise.all([
    supabase.from("merchant_plan_payments").select("plan, paid_at, valid_until").eq("user_id", store.billing_owner_id).eq("status", "approved").order("valid_until", { ascending: false }).order("plan", { ascending: false }).order("id").limit(1).maybeSingle(),
    supabase.from("merchant_plan_payments").select("id, plan, amount_vnd, upgrade_amount_vnd, upgrade_expires_at, received_amount_vnd, status, created_at, paid_at, valid_until, transfer_code", { count: "exact" }).eq("user_id", store.billing_owner_id).order("created_at", { ascending: false }).order("id").range(start, start + pageSize - 1),
  ]) : [null, null];
  const plan = current?.data;
  return <main className="admin-content subscriptions-page"><Link className="subscriptions-back" href="/admin/subscriptions">← Danh sách đăng ký</Link>
    <header className="subscription-hero"><span aria-hidden="true">◈</span><div><small>ĐĂNG KÝ DỊCH VỤ</small><h1>{store.name}</h1><p>/{store.slug}</p></div><Link href={`/admin/stores/${store.id}`}>Hồ sơ cửa hàng ↗</Link></header>
    <section className="subscription-summary" aria-label="Thông tin gói"><article><small>Gói gần nhất</small><b>{current?.error ? "Không tải được" : plan ? findMerchantPlan(plan.plan)?.name ?? plan.plan : "Chưa có"}</b></article><article><small>Trạng thái</small><b>{current?.error ? "Không tải được" : !store.billing_owner_id ? "Chưa liên kết" : !plan ? "Chưa có gói" : isActive(plan.valid_until) ? "Còn hiệu lực" : "Hết hạn"}</b></article><article><small>Thanh toán gần nhất</small><b>{date(plan?.paid_at)}</b></article><article><small>Ngày hết hạn</small><b>{date(plan?.valid_until)}</b></article></section>
    <div className="subscriptions-note"><strong>Thông tin chưa được lưu</strong><p>Ngày bắt đầu và lịch sử hạ cấp không có dữ liệu riêng. Các thao tác gia hạn thủ công, hủy, tạm dừng, kích hoạt lại và thời gian ân hạn chưa được hỗ trợ.</p></div>
    <section className="subscriptions-panel"><div className="subscriptions-panel-heading"><div><h2>Lịch sử giao dịch gói</h2><p>Gồm mua mới, gia hạn và nâng cấp đã được ghi nhận.</p></div><Link href="/admin/plan-payments">Quản lý giao dịch →</Link></div>
      {!store.billing_owner_id ? <p className="subscriptions-empty">Cửa hàng chưa liên kết chủ thanh toán.</p> : history?.error ? <p className="subscriptions-empty" role="alert">Không tải được lịch sử giao dịch.</p> : !history?.data?.length ? <p className="subscriptions-empty">Chưa có giao dịch gói.</p> : <div className="subscriptions-scroll"><table><thead><tr><th>Gói</th><th>Loại</th><th>Số tiền</th><th>Trạng thái</th><th>Ngày tạo</th><th>Ngày thanh toán</th><th>Hết hạn</th><th>Mã giao dịch</th></tr></thead><tbody>{history.data.map((item) => {
        const late = item.paid_at && item.upgrade_expires_at && Date.parse(item.paid_at) >= Date.parse(item.upgrade_expires_at);
        return <tr key={item.id}><td>{findMerchantPlan(item.plan)?.name ?? item.plan}</td><td>{item.upgrade_amount_vnd != null ? "Nâng cấp" : "Mua mới / gia hạn"}</td><td>{formatPlanAmount(item.received_amount_vnd ?? item.upgrade_amount_vnd ?? item.amount_vnd)}</td><td>{late ? "Cần đối soát" : statuses[item.status] ?? item.status}</td><td>{date(item.created_at)}</td><td>{date(item.paid_at)}</td><td>{date(item.valid_until)}</td><td><code>{item.transfer_code}</code></td></tr>;
      })}</tbody></table></div>}
      {history && !history.error && (page > 1 || start + pageSize < (history.count ?? 0)) && <nav className="subscriptions-pagination" aria-label="Phân trang lịch sử">{page > 1 && <Link href={`/admin/subscriptions/${store.id}?page=${page - 1}`}>← Trang trước</Link>}<span>Trang {page}</span>{start + pageSize < (history.count ?? 0) && <Link href={`/admin/subscriptions/${store.id}?page=${page + 1}`}>Trang sau →</Link>}</nav>}
    </section>
  </main>;
}
