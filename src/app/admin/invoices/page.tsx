import Link from "next/link";
import SidebarIcon from "@/components/ui/sidebar-icon";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { filterInvoices, invoiceCode, invoiceDay, invoiceMoney, invoicePlans, invoiceQuery, invoiceStatusLabel, invoiceStatuses, readInvoiceFilters, type InvoiceSearchParams } from "@/lib/admin/invoices";
import "./invoices.css";

const pageSize = 25;
const metrics = [
  { key: "total", label: "Tổng hóa đơn", icon: "orders", tone: "blue" },
  { key: "value", label: "Tổng giá trị", icon: "payment", tone: "violet" },
  { key: "paid_value", label: "Đã thu", icon: "payment", tone: "green" },
  { key: "balance", label: "Còn phải thu", icon: "overview", tone: "amber" },
] as const;
const indicators = [
  ["paid", "Đã thanh toán"], ["unpaid", "Chưa thanh toán"], ["overdue", "Quá hạn"],
  ["due_soon", "Đến hạn trong 7 ngày"], ["review", "Cần đối soát"], ["cancelled", "Đã hủy"],
] as const;
type Summary = Record<(typeof metrics)[number]["key"] | (typeof indicators)[number][0], number> & {
  debtors: { customer_id: string; store_id: string | null; name: string; balance: number }[];
};
export default async function Invoices({ searchParams }: { searchParams: Promise<InvoiceSearchParams> }) {
  const [supabase, query] = await Promise.all([createClient(), searchParams]);
  await requirePlatformAdminAccess(supabase);
  const filters = readInvoiceFilters((key) => query[key]);
  const page = typeof query.page === "string" && /^[1-9][0-9]{0,5}$/.test(query.page) ? Number(query.page) : 1;
  const start = (page - 1) * pageSize;
  const list = supabase.from("admin_service_invoice_view")
    .select("id, invoice_number, store_name, customer_name, plan_name, amount_vnd, issued_at, due_on, invoice_status, transfer_code, paid_vnd, balance_vnd, days_past_due", { count: "exact" });
  filterInvoices(list, filters);
  const ascending = filters.order === "oldest";
  const [result, summary] = await Promise.all([
    list.order("issued_at", { ascending }).order("invoice_number", { ascending }).range(start, start + pageSize - 1),
    supabase.rpc("admin_service_invoice_summary"),
  ]);
  const totals = summary.data as Summary | null;
  const hasDates = Boolean(filters.issuedFrom || filters.issuedTo || filters.dueFrom || filters.dueTo);
  const hasFilters = Object.values(filters).some(Boolean);
  const count = result.count ?? 0;
  const last = Math.min(start + pageSize, count);
  const href = (next: number) => `/admin/invoices${invoiceQuery(filters, next)}`;

  return <main className="admin-content invoices-page invoice-list">
    <header className="invoice-list-banner">
      <div className="invoice-list-title">
        <span className="invoice-banner-icon"><SidebarIcon name="orders" /></span>
        <div><h1>Hóa đơn dịch vụ</h1><p>Quản lý khoản thu gói GrowDesk và công nợ cửa hàng.</p></div>
      </div>
      <Link className="invoice-create-link" href="/admin/invoices/new"><span aria-hidden="true">+</span> Tạo hóa đơn</Link>
    </header>

    {summary.error && <p role="alert" className="admin-error">Chưa tải được tổng quan hóa đơn.</p>}
    {totals && <section aria-label="Tổng quan toàn bộ hóa đơn" className="invoice-overview">
      <dl className="invoice-metric-grid">
        {metrics.map(({ key, label, icon, tone }) => <div key={key} className="invoice-metric" data-tone={tone}>
          <dt><span className="invoice-metric-icon"><SidebarIcon name={icon} /></span>{label}</dt>
          <dd>{key === "total" ? totals[key].toLocaleString("vi-VN") : invoiceMoney(totals[key])}</dd>
        </div>)}
      </dl>
      <dl className="invoice-indicators">{indicators.map(([key, label]) => <div key={key} data-indicator={key}>
        <dt>{label}</dt><dd>{totals[key].toLocaleString("vi-VN")}</dd>
      </div>)}</dl>
      {totals.debtors?.length > 0 && <details className="invoice-debtors">
        <summary>Công nợ theo cửa hàng hoặc tài khoản <small>Tối đa 20 khoản lớn nhất</small></summary>
        <ol>{totals.debtors.map((debtor) => <li key={`${debtor.customer_id}:${debtor.store_id}`}>
          <span>{debtor.name}</span><strong>{invoiceMoney(debtor.balance)}</strong>
        </li>)}</ol>
      </details>}
    </section>}

    <section className="invoices-panel invoice-list-panel" aria-labelledby="invoice-list-heading">
      <header>
        <div><h2 id="invoice-list-heading">Danh sách hóa đơn</h2><p>{result.error ? "Không tải được dữ liệu" : `${count.toLocaleString("vi-VN")} hóa đơn${hasFilters ? " phù hợp" : ""}`}</p></div>
        <Link className="invoice-export-link" href={`/admin/invoices/export${invoiceQuery(filters)}`} prefetch={false} download>Xuất CSV <span aria-hidden="true">↓</span></Link>
      </header>
      <form className="invoice-list-filters" action="/admin/invoices">
        <div className="invoice-list-filter-row">
          <label>Tìm kiếm<span className="invoice-search-input"><SidebarIcon name="search" /><input name="q" defaultValue={filters.q} maxLength={80} placeholder="Mã hóa đơn, cửa hàng hoặc mã chuyển khoản" /></span></label>
          <label>Trạng thái<select name="status" defaultValue={filters.status}><option value="">Tất cả</option>{Object.entries(invoiceStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Gói dịch vụ<select name="plan" defaultValue={filters.plan}><option value="">Tất cả</option>{Object.entries(invoicePlans).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Sắp xếp<select name="order" defaultValue={filters.order}><option value="">Mới nhất</option><option value="oldest">Cũ nhất</option></select></label>
        </div>
        <div className="invoice-filter-options">
          <details className="invoice-date-filters" open={hasDates}>
            <summary>Khoảng ngày</summary>
            <div className="invoice-date-fields">
              <label>Phát hành từ<input type="date" name="issuedFrom" defaultValue={filters.issuedFrom} /></label>
              <label>Phát hành đến<input type="date" name="issuedTo" defaultValue={filters.issuedTo} /></label>
              <label>Hạn thanh toán từ<input type="date" name="dueFrom" defaultValue={filters.dueFrom} /></label>
              <label>Hạn thanh toán đến<input type="date" name="dueTo" defaultValue={filters.dueTo} /></label>
            </div>
          </details>
          <div className="invoice-filter-buttons">{hasFilters && <Link href="/admin/invoices">Xóa bộ lọc</Link>}<button className="invoice-primary" type="submit">Áp dụng bộ lọc</button></div>
        </div>
      </form>
      {result.error ? <div className="invoice-list-empty" role="alert"><strong>Chưa tải được hóa đơn</strong><p>Vui lòng thử lại hoặc kiểm tra migration quản lý hóa đơn.</p><Link href={href(page)}>Thử lại</Link></div>
        : !result.data?.length ? <div className="invoice-list-empty"><SidebarIcon name="orders" /><strong>{hasFilters ? "Không có hóa đơn phù hợp" : "Chưa có hóa đơn"}</strong><Link href={hasFilters ? "/admin/invoices" : "/admin/invoices/new"}>{hasFilters ? "Xóa bộ lọc" : "Tạo hóa đơn"}</Link></div>
        : <div className="invoice-table-wrap" role="region" aria-label="Bảng hóa đơn. Có thể cuộn ngang." tabIndex={0}>
          <table><thead><tr>
            <th scope="col">Mã hóa đơn</th><th scope="col">Cửa hàng / tài khoản</th><th scope="col">Gói dịch vụ</th><th scope="col">Phát hành</th><th scope="col">Đến hạn</th><th scope="col" className="invoice-amount">Tổng tiền</th><th scope="col" className="invoice-amount">Đã thu</th><th scope="col" className="invoice-amount">Còn phải trả</th><th scope="col">Trạng thái</th>
          </tr></thead><tbody>{result.data.map((row) => <tr key={row.id}>
            <td><Link className="invoice-row-link" href={`/admin/invoices/${row.id}`}>{invoiceCode(row.invoice_number)}</Link><small>{row.transfer_code}</small></td>
            <td className="invoice-account-cell">{row.store_name ?? row.customer_name}</td><td>{row.plan_name}</td>
            <td>{invoiceDay(row.issued_at)}</td><td>{invoiceDay(row.due_on)}{row.invoice_status === "overdue" && <small className="invoice-late-days">{row.days_past_due} ngày quá hạn</small>}</td>
            <td className="invoice-amount">{invoiceMoney(row.amount_vnd)}</td><td className="invoice-amount">{invoiceMoney(row.paid_vnd)}</td><td className="invoice-amount invoice-balance">{invoiceMoney(row.balance_vnd)}</td>
            <td><span className={`invoice-status is-${row.invoice_status}`}>{invoiceStatusLabel(row.invoice_status)}</span></td>
          </tr>)}</tbody></table>
        </div>}
      {!result.error && (count > 0 || page > 1) && <footer className="invoice-list-footer">
        <span>{start < last ? `${start + 1}–${last} / ${count.toLocaleString("vi-VN")} hóa đơn` : `Trang ${page}`}</span>
        {(page > 1 || last < count) && <nav aria-label="Phân trang hóa đơn">{page > 1 && <Link href={href(page - 1)}>← Trang trước</Link>}{last < count && <Link href={href(page + 1)}>Trang sau →</Link>}</nav>}
      </footer>}
    </section>
  </main>;
}
