import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { invoiceDay, invoiceMoney, invoicePlans, invoiceUuid, invoiceVietnamDay, todayInVietnam } from "@/lib/admin/invoices";
import IssueInvoiceForm from "./issue-invoice-form";
import "../invoices.css";

type Candidate = { id: string; plan: string; transfer_code: string; amount_vnd: number; store_name: string | null; store_slug: string | null; customer_name: string };
const planName = (key: string) => invoicePlans[key as keyof typeof invoicePlans] ?? key;
function paymentIsEligible(status: string, paidAt: string | null, expiresAt: string | null) {
  return ["pending", "approved"].includes(status)
    && (!expiresAt || new Date(paidAt ?? Date.now()) < new Date(expiresAt));
}
export default async function NewInvoice({ searchParams }: { searchParams: Promise<{ payment?: string; q?: string; plan?: string; message?: string }> }) {
  const [supabase, query] = await Promise.all([createClient(), searchParams]);
  await requirePlatformAdminAccess(supabase);
  const id = typeof query.payment === "string" && invoiceUuid.test(query.payment) ? query.payment : null;
  const term = typeof query.q === "string" ? query.q.trim().slice(0, 80) : "";
  const plan = typeof query.plan === "string" && Object.hasOwn(invoicePlans, query.plan) ? query.plan : "";
  if (id) {
    const existing = await supabase.from("service_invoices").select("id").eq("payment_id", id).maybeSingle();
    if (existing.data) redirect(`/admin/invoices/${existing.data.id}`);
  }
  const candidates = id ? null : await supabase.rpc("admin_service_invoice_candidates", { term, requested_plan: plan || null });
  const payment = id ? await supabase.from("merchant_plan_payments")
    .select("id, user_id, plan, amount_vnd, upgrade_amount_vnd, upgrade_expires_at, paid_at, valid_until, transfer_code, status, created_at")
    .eq("id", id).maybeSingle() : null;
  const result = payment?.data;
  const [store, profile] = result ? await Promise.all([
    supabase.rpc("admin_invoice_billing_store", { buyer: result.user_id }).maybeSingle<{ name: string; slug: string }>(),
    supabase.from("profiles").select("display_name").eq("id", result.user_id).maybeSingle(),
  ]) : [null, null];
  const eligible = result && paymentIsEligible(result.status, result.paid_at, result.upgrade_expires_at);
  const today = todayInVietnam();
  return <main className="admin-content invoices-page">
    <Link className="invoice-back" href="/admin/invoices">← Danh sách hóa đơn</Link>
    <section className="invoice-card"><h1>Phát hành hóa đơn dịch vụ</h1>
      <p>Chọn yêu cầu đăng ký, gia hạn hoặc nâng cấp đã có. Giá được lấy từ yêu cầu thanh toán gốc.</p>
      {query.message && <p className="admin-error" role="alert">Không phát hành được. Anh hãy kiểm tra ngày, dữ liệu nhập và trạng thái giao dịch.</p>}
      {!id && <>
        <form className="invoice-filter-form" action="/admin/invoices/new">
          <label>Cửa hàng hoặc giao dịch<input name="q" defaultValue={term} maxLength={80} placeholder="Tên, slug hoặc mã chuyển khoản" /></label>
          <label>Gói<select name="plan" defaultValue={plan}><option value="">Tất cả</option>{Object.entries(invoicePlans).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <button className="invoice-primary" type="submit">Tìm yêu cầu thanh toán</button>
        </form>
        {candidates?.error ? <p role="alert">Chưa tải được danh sách yêu cầu thanh toán.</p> : (candidates?.data as Candidate[] | null)?.length
          ? <ul className="invoice-candidates">{(candidates?.data as Candidate[]).map(row => <li key={row.id}><Link href={`/admin/invoices/new?payment=${row.id}`}><b>{row.store_name ?? row.customer_name}</b><span>{row.store_slug ? `/${row.store_slug} · ` : ""}{planName(row.plan)} · {row.transfer_code} · {invoiceMoney(row.amount_vnd)}</span></Link></li>)}</ul>
          : <p>Không có yêu cầu thanh toán phù hợp chưa được lập hóa đơn.</p>}
      </>}
      {id && (!eligible || payment.error || store?.error || profile?.error
        ? <p role="alert">Yêu cầu thanh toán không đủ điều kiện hoặc chưa tải được dữ liệu. <Link href="/admin/invoices/new">Chọn yêu cầu khác</Link></p>
        : <><Link href="/admin/invoices/new">Đổi yêu cầu thanh toán</Link><dl className="invoice-fields">
          <div><dt>Cửa hàng / tài khoản</dt><dd>{store?.data?.name ?? profile?.data?.display_name ?? "Tài khoản chưa có cửa hàng"}</dd></div>
          <div><dt>Gói dịch vụ</dt><dd>{planName(result.plan)}</dd></div>
          <div><dt>Mã chuyển khoản</dt><dd>{result.transfer_code}</dd></div>
          <div><dt>Chu kỳ / thời hạn</dt><dd>{result.upgrade_expires_at ? `Nâng cấp đến ${invoiceDay(result.upgrade_expires_at)}` : `Một tháng${result.valid_until ? ` · đến ${invoiceDay(result.valid_until)}` : " · xác định khi thanh toán được xác nhận"}`}</dd></div>
          <div><dt>Tổng tiền snapshot</dt><dd>{invoiceMoney(result.upgrade_amount_vnd ?? result.amount_vnd)}</dd></div>
        </dl><IssueInvoiceForm paymentId={id} today={today} earliest={invoiceVietnamDay(result.created_at)} /></>)}
    </section>
  </main>;
}
