import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { defaultPlatformSettings, getPlatformSettings } from "@/lib/platform-settings";
import { invoiceCode, invoiceDay, invoiceMoney, invoiceStatusLabel, invoiceUuid } from "@/lib/admin/invoices";
import { cancelInvoice, recordInvoiceTransfer } from "../actions";
import PrintButton from "../print-button";
import Toast from "@/components/ui/toast";
import "../invoices.css";

const messages: Record<string, string> = {
  issued: "Đã phát hành hóa đơn.", recorded: "Đã ghi nhận chuyển khoản.", cancelled: "Đã hủy hóa đơn.",
  "transfer-failed": "Chưa ghi nhận được. Kiểm tra số tiền, thời điểm và trạng thái yêu cầu thanh toán.",
  "transfer-invalid": "Thông tin chuyển khoản chưa hợp lệ.",
  "duplicate-transfer": "Mã giao dịch ngân hàng đã được sử dụng.",
  invalid: "Lý do hủy phải có từ 5 đến 500 ký tự.",
  failed: "Chỉ có thể hủy hóa đơn gắn với yêu cầu đang chờ thanh toán.",
};
const timestamps = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
const dateTime = (value: string | null) => value ? timestamps.format(new Date(value)) : "—";

export default async function InvoiceDetail({ params, searchParams }: { params: Promise<{ invoiceId: string }>; searchParams: Promise<{ message?: string }> }) {
  const [{ invoiceId }, query, supabase] = await Promise.all([params, searchParams, createClient()]);
  if (!invoiceUuid.test(invoiceId)) notFound();
  await requirePlatformAdminAccess(supabase);
  const [result, platform] = await Promise.all([
    supabase.from("admin_service_invoice_view").select("*").eq("id", invoiceId).maybeSingle(),
    getPlatformSettings(),
  ]);
  if (result.error) return <main className="admin-content"><p role="alert" className="admin-error">Không tải được hóa đơn.</p><Link href="/admin/invoices">← Danh sách hóa đơn</Link></main>;
  const invoice = result.data;
  if (!invoice) notFound();
  const settings = platform.settings ?? defaultPlatformSettings;
  const message = typeof query.message === "string" && Object.hasOwn(messages, query.message) ? messages[query.message] : null;
  const pending = invoice.payment_status === "pending" && !invoice.cancelled_at;
  const canRecord = pending && invoice.balance_vnd > 0;
  const paid = invoice.invoice_status === "paid";
  return <main className="admin-content invoices-page">
    <Link className="invoice-back invoice-no-print" href="/admin/invoices">← Danh sách hóa đơn</Link>
    {message && <div className="invoice-no-print"><Toast message={message} variant={["issued", "recorded", "cancelled"].includes(query.message ?? "") ? "success" : "error"} /></div>}
    <article className="invoice-card invoice-document">
      <header className="invoice-document-heading"><div>
        {settings.logo_url && <Image src={settings.logo_url} alt="" width={110} height={35} unoptimized style={{ objectFit: "contain" }} />}
        <span>{settings.platform_name}</span><h1>Hóa đơn dịch vụ</h1>
        {settings.contact_email && <p>{settings.contact_email}</p>}{settings.support_phone && <p>{settings.support_phone}</p>}
      </div><div><strong>{invoiceCode(invoice.invoice_number)}</strong><p>Phát hành {invoiceDay(invoice.issued_at)}</p><span className={`invoice-status is-${invoice.invoice_status}`}>{invoiceStatusLabel(invoice.invoice_status)}</span></div></header>
      <dl className="invoice-fields">
        <div><dt>Cửa hàng / tài khoản</dt><dd>{invoice.store_name ?? invoice.customer_name}</dd></div>
        {invoice.store_slug && <div><dt>Mã cửa hàng</dt><dd>{invoice.store_slug}</dd></div>}
        {invoice.store_phone && <div><dt>Liên hệ cửa hàng</dt><dd>{invoice.store_phone}</dd></div>}
        <div><dt>Hạn thanh toán</dt><dd>{invoiceDay(invoice.due_on)}{invoice.invoice_status === "overdue" && ` · quá hạn ${invoice.days_past_due} ngày`}</dd></div>
        <div><dt>Mã chuyển khoản</dt><dd>{invoice.transfer_code}</dd></div>
        <div><dt>Dịch vụ</dt><dd>{invoice.plan_name}{invoice.description && <p>{invoice.description}</p>}</dd></div>
        <div><dt>Chu kỳ</dt><dd>{invoice.upgrade_expires_at ? "Nâng cấp đến hết kỳ hiện tại" : "Một tháng"}</dd></div>
        <div><dt>Thời điểm xác nhận thu</dt><dd>{dateTime(invoice.paid_at)}</dd></div>
        {invoice.service_starts_at && <div><dt>Bắt đầu kỳ dịch vụ</dt><dd>{invoiceDay(invoice.service_starts_at)}</dd></div>}
        <div><dt>Thời hạn dịch vụ</dt><dd>{invoice.valid_until ? `Đến ${invoiceDay(invoice.valid_until)}` : invoice.upgrade_expires_at ? `Đến ${invoiceDay(invoice.upgrade_expires_at)} nếu thanh toán hợp lệ` : "Xác định khi khoản thu được xác nhận"}</dd></div>
        <div><dt>Đơn giá snapshot · 1 gói</dt><dd>{invoiceMoney(invoice.amount_vnd)}</dd></div>
      </dl>
      <dl className="invoice-fields invoice-total">
        <div><dt>Tổng tiền</dt><dd>{invoiceMoney(invoice.amount_vnd)}</dd></div>
        <div><dt>Đã thu hợp lệ</dt><dd>{invoiceMoney(invoice.paid_vnd)}</dd></div>
        <div><dt>Còn phải trả</dt><dd>{invoiceMoney(invoice.balance_vnd)}</dd></div>
      </dl>
      <p className="invoice-document-footnote">Chứng từ nội bộ dùng để theo dõi phí dịch vụ GrowDesk.</p>
    </article>
    <section className="invoice-card invoice-no-print">
      <h2>Giao dịch và lịch sử</h2>
      <dl className="invoice-fields">
        <div><dt>Người phát hành</dt><dd>{invoice.issued_by}</dd></div>
        <div><dt>Tạo / cập nhật gần nhất</dt><dd>{dateTime(invoice.created_at)} / {dateTime(invoice.updated_at)}</dd></div>
        {invoice.internal_note && <div><dt>Ghi chú nội bộ</dt><dd>{invoice.internal_note}</dd></div>}
        {invoice.cancelled_at && <div><dt>Hủy hóa đơn</dt><dd>{dateTime(invoice.cancelled_at)} · {invoice.cancelled_by}<p>{invoice.cancellation_reason}</p></dd></div>}
        {invoice.payment_method && <>
          <div><dt>Phương thức</dt><dd>{invoice.payment_method === "bank" ? "Chuyển khoản · Admin đối soát" : "Chuyển khoản · SePay"}</dd></div>
          <div><dt>Tham chiếu giao dịch</dt><dd>{invoice.transaction_reference}</dd></div>
          <div><dt>Số tiền giao dịch</dt><dd>{invoice.received_amount_vnd != null ? invoiceMoney(invoice.received_amount_vnd) : paid ? invoiceMoney(invoice.paid_vnd) : "Chờ đối soát"}</dd></div>
          {invoice.bank_recorded_by && <div><dt>Người ghi nhận</dt><dd>{invoice.bank_recorded_by} · {dateTime(invoice.bank_recorded_at)}</dd></div>}
          {invoice.bank_note && <div><dt>Ghi chú đối soát</dt><dd>{invoice.bank_note}</dd></div>}
        </>}
      </dl>
      {!invoice.payment_method && <p>Chưa có giao dịch được ghi nhận.</p>}
      {invoice.invoice_status === "review" && <p>Yêu cầu cần đối soát trước khi tính vào tiền thu hoặc công nợ.</p>}
    </section>
    <div className="invoice-detail-actions invoice-no-print"><PrintButton />
      {canRecord && <details><summary>Ghi nhận chuyển khoản</summary><form action={recordInvoiceTransfer} className="invoice-cancel-form">
        <input type="hidden" name="invoice_id" value={invoice.id} />
        <label>Số tiền thực nhận (VND)<input type="number" name="amount" min={1} max={invoice.balance_vnd} step={1} defaultValue={invoice.balance_vnd} required /></label>
        <label>Thời điểm chuyển khoản (giờ Việt Nam)<input type="datetime-local" name="paid_at" step={1} required /></label>
        <label>Mã giao dịch ngân hàng<input name="reference" minLength={3} maxLength={120} required /></label>
        <label>Ghi chú đối soát<textarea name="note" maxLength={1000} rows={2} /></label>
        <p>Chỉ xác nhận sau khi đối chiếu sao kê. Thu đủ tiền sẽ áp dụng quy tắc kích hoạt hoặc gia hạn gói hiện tại.</p>
        <button className="invoice-primary" type="submit">Xác nhận đã nhận đủ tiền</button>
      </form></details>}
      {pending && <details><summary>Hủy hóa đơn</summary><form action={cancelInvoice} className="invoice-cancel-form">
        <input type="hidden" name="invoice_id" value={invoice.id} /><label>Lý do hủy<textarea name="reason" minLength={5} maxLength={500} required rows={3} /></label>
        <p>Hủy hóa đơn giữ nguyên yêu cầu thanh toán và gói dịch vụ.</p><button type="submit">Xác nhận hủy hóa đơn</button>
      </form></details>}
    </div>
  </main>;
}
