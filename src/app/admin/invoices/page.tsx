import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import "./invoices.css";

const labels: Record<string, string> = { unpaid: "Chưa thanh toán", paid: "Đã thanh toán", cancelled: "Đã hủy", review: "Cần đối soát" };
const dates = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
const money = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" });
const pageSize = 25;
export default async function Invoices({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const [supabase, query] = await Promise.all([createClient(), searchParams]);
  await requirePlatformAdminAccess(supabase);
  const status = typeof query.status === "string" && Object.hasOwn(labels, query.status) ? query.status : "";
  const page = typeof query.page === "string" && /^[1-9]\d{0,5}$/.test(query.page) ? Number(query.page) : 1;
  const start = (page - 1) * pageSize;
  let request = supabase.from("admin_service_invoice_view").select("id, invoice_number, customer_name, plan_name, amount_vnd, issued_at, invoice_status, transfer_code", { count: "exact" }).order("issued_at", { ascending: false }).order("id").range(start, start + pageSize - 1);
  if (status) request = request.eq("invoice_status", status);
  const result = await request;
  function href(next: number) { const params = new URLSearchParams({ page: String(next) }); if (status) params.set("status", status); return `/admin/invoices?${params}`; }
  return <main className="admin-content invoices-page"><header className="invoices-heading"><span aria-hidden="true">▤</span><div><div className="dashboard-kicker">QUẢN LÝ KINH DOANH</div><h1 className="admin-page-title">Hóa đơn dịch vụ</h1><p>Quản lý chứng từ gắn với giao dịch thanh toán gói.</p></div><Link href="/admin/plan-payments">+ Tạo từ giao dịch</Link></header>
    <div className="invoices-note"><b>Chứng từ nội bộ</b><p>Chứng từ này phục vụ theo dõi thanh toán và không phải hóa đơn điện tử hoặc chứng từ thuế. Để tạo, chọn giao dịch ở trang thanh toán gói.</p></div>
    <nav className="invoice-filters" aria-label="Lọc trạng thái"><Link href="/admin/invoices" aria-current={!status ? "true" : undefined}>Tất cả</Link>{Object.entries(labels).map(([value, label]) => <Link key={value} href={`/admin/invoices?status=${value}`} aria-current={status === value ? "true" : undefined}>{label}</Link>)}</nav>
    <section className="invoices-panel"><header><div><h2>Danh sách chứng từ</h2><p>{result.error ? "Không tải được dữ liệu" : `${(result.count ?? 0).toLocaleString("vi-VN")} chứng từ`}</p></div><Link href="/admin/invoices/export" prefetch={false} download>Xuất CSV →</Link></header>
      {result.error ? <p className="invoice-empty" role="alert">Chưa tải được chứng từ. Cần chạy migration 202611180006_service_invoices.sql.</p> : !result.data?.length ? <p className="invoice-empty">Chưa có chứng từ phù hợp.</p> : <div className="invoice-table-wrap"><table><thead><tr><th>Số chứng từ</th><th>Khách hàng</th><th>Gói dịch vụ</th><th>Số tiền</th><th>Ngày tạo</th><th>Trạng thái</th><th /></tr></thead><tbody>{result.data.map((row) => <tr key={row.id}><td><Link href={`/admin/invoices/${row.id}`}><b>DV-{String(row.invoice_number).padStart(6, "0")}</b></Link><small>{row.transfer_code}</small></td><td>{row.customer_name}</td><td>{row.plan_name}</td><td>{money.format(row.amount_vnd)}</td><td>{dates.format(new Date(row.issued_at))}</td><td><span className={`invoice-status is-${row.invoice_status}`}>{labels[row.invoice_status] ?? row.invoice_status}</span></td><td><Link href={`/admin/invoices/${row.id}`}>Chi tiết →</Link></td></tr>)}</tbody></table></div>}
      {!result.error && (page > 1 || start + pageSize < (result.count ?? 0)) && <nav className="invoice-pagination">{page > 1 && <Link href={href(page - 1)}>← Trang trước</Link>}<span>Trang {page}</span>{start + pageSize < (result.count ?? 0) && <Link href={href(page + 1)}>Trang sau →</Link>}</nav>}
    </section>
  </main>;
}
