import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { cancelInvoice } from "../actions";
import PrintButton from "../print-button";
import "../invoices.css";
const labels: Record<string, string> = { unpaid: "Chưa thanh toán", paid: "Đã thanh toán", cancelled: "Đã hủy", review: "Cần đối soát" };
const dates = new Intl.DateTimeFormat("vi-VN", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
const money = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" });
export default async function InvoiceDetail({ params, searchParams }: { params: Promise<{ invoiceId: string }>; searchParams: Promise<{ message?: string }> }) {
  const [{ invoiceId }, query, supabase] = await Promise.all([params, searchParams, createClient()]);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoiceId)) notFound();
  await requirePlatformAdminAccess(supabase);
  const result = await supabase.from("admin_service_invoice_view").select("id, invoice_number, customer_name, plan_name, amount_vnd, issued_at, transfer_code, paid_at, invoice_status, payment_status, cancellation_reason, cancelled_at").eq("id", invoiceId).maybeSingle();
  if (result.error) return <main className="admin-content"><p className="admin-error">Không tải được chứng từ.</p><Link href="/admin/invoices">← Danh sách chứng từ</Link></main>;
  const invoice = result.data;
  if (!invoice) notFound();
  return <main className="admin-content invoices-page"><Link className="invoice-back invoice-no-print" href="/admin/invoices">← Danh sách chứng từ</Link>{query.message && <p className={query.message === "cancelled" ? "invoice-success invoice-no-print" : "admin-error invoice-no-print"} role="status">{query.message === "cancelled" ? "Đã hủy chứng từ." : "Không hủy được chứng từ. Chỉ chứng từ chưa thanh toán mới có thể hủy; hãy kiểm tra lại trạng thái và lý do."}</p>}
    <article className="invoice-card invoice-document"><header className="invoice-document-heading"><div><span>CHỨNG TỪ DỊCH VỤ NỘI BỘ</span><h1>Chi tiết thanh toán</h1><p>Không phải hóa đơn điện tử hoặc chứng từ thuế</p></div><div><strong>DV-{String(invoice.invoice_number).padStart(6, "0")}</strong><p>{dates.format(new Date(invoice.issued_at))}</p><span className={`invoice-status is-${invoice.invoice_status}`}>{labels[invoice.invoice_status] ?? invoice.invoice_status}</span></div></header>
      <dl className="invoice-fields"><div><dt>Khách hàng</dt><dd>{invoice.customer_name}</dd></div><div><dt>Gói dịch vụ</dt><dd>{invoice.plan_name}</dd></div><div><dt>Mã thanh toán</dt><dd>{invoice.transfer_code}</dd></div><div><dt>Trạng thái giao dịch</dt><dd>{{ pending: "Chờ thanh toán", approved: "Đã xác nhận", expired: "Hết hạn", cancelled: "Đã hủy", needs_review: "Cần đối soát" }[invoice.payment_status as string] ?? invoice.payment_status}</dd></div><div><dt>Ngày thanh toán</dt><dd>{invoice.paid_at ? dates.format(new Date(invoice.paid_at)) : "Chưa có dữ liệu"}</dd></div>{invoice.cancelled_at && <div><dt>Lý do hủy</dt><dd>{invoice.cancellation_reason}</dd></div>}</dl>
      <div className="invoice-total"><span>Tổng tiền</span><strong>{money.format(invoice.amount_vnd)}</strong></div>
      <p className="invoice-document-footnote">Trạng thái thanh toán theo giao dịch liên kết tại thời điểm xem.</p>
    </article>
    <div className="invoice-detail-actions invoice-no-print"><PrintButton />{invoice.invoice_status === "unpaid" && <details><summary>Hủy chứng từ</summary><form action={cancelInvoice} className="invoice-cancel-form"><input type="hidden" name="invoice_id" value={invoice.id} /><label>Lý do hủy<textarea name="reason" minLength={5} maxLength={500} required rows={3} /></label><p>Việc hủy chứng từ không hủy mã thanh toán hoặc thay đổi gói dịch vụ.</p><button type="submit">Xác nhận hủy</button></form></details>}</div>
  </main>;
}
