import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { findMerchantPlan, formatPlanAmount } from "@/lib/merchant-plans";
import { createInvoice } from "../actions";
import "../invoices.css";
export default async function NewInvoice({ searchParams }: { searchParams: Promise<{ payment?: string; message?: string }> }) {
  const [supabase, query] = await Promise.all([createClient(), searchParams]);
  await requirePlatformAdminAccess(supabase);
  const id = query.payment ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return <main className="admin-content"><p>Hãy chọn một giao dịch.</p><Link href="/admin/plan-payments">Xem giao dịch →</Link></main>;
  const payment = await supabase.from("merchant_plan_payments").select("id, plan, amount_vnd, upgrade_amount_vnd, transfer_code, status").eq("id", id).maybeSingle();
  return <main className="admin-content invoices-page"><Link className="invoice-back" href="/admin/plan-payments">← Danh sách giao dịch</Link><section className="invoice-card"><h1>Tạo chứng từ dịch vụ</h1><p>Chứng từ nội bộ, không phải hóa đơn điện tử. Mỗi giao dịch chỉ có một chứng từ.</p>{query.message && <p className="admin-error" role="alert">Không tạo được chứng từ. Kiểm tra trạng thái giao dịch hoặc migration.</p>}{payment.error || !payment.data ? <p>Không tải được giao dịch.</p> : <><dl className="invoice-fields"><div><dt>Mã giao dịch</dt><dd>{payment.data.transfer_code}</dd></div><div><dt>Gói</dt><dd>{findMerchantPlan(payment.data.plan)?.name ?? payment.data.plan}</dd></div><div><dt>Số tiền</dt><dd>{formatPlanAmount(payment.data.upgrade_amount_vnd ?? payment.data.amount_vnd)}</dd></div><div><dt>Trạng thái giao dịch</dt><dd>{payment.data.status}</dd></div></dl><form action={createInvoice}><input type="hidden" name="payment_id" value={id} /><button className="invoice-primary" type="submit">Tạo chứng từ</button></form></>}</section></main>;
}
