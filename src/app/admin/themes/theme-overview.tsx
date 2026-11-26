import Link from "next/link";
import Form from "next/form";
import type { createClient } from "@/lib/supabase/server";
import { overviewPeriods, themeOverviewFilters } from "@/lib/theme-overview";
import { themeFamilies } from "@/lib/theme-studio";
import ThemeCover from "@/components/ui/theme-cover";
import { ThemePager, type Query } from "./theme-admin-sections";
import OverviewRefresh from "./overview-refresh";

type Point = { date: string; orders: number; paid: number; revenue: number; installations: number };
type RankedTheme = {
  id: string; name: string; primary_family: keyof typeof themeFamilies; preview_url: string | null;
  lifecycle: "draft" | "published" | "archived"; version: string | null; listed: boolean;
  installations: number; stores: number; purchases: number; revenue: number;
};
const activities = {
  created: "Tạo giao diện", published: "Phát hành lần đầu", updated: "Phát hành phiên bản mới",
  claimed: "Nhận giao diện miễn phí", granted: "Cấp giấy phép", revoked: "Thu hồi giấy phép",
  ordered: "Tạo đơn mua", paid: "Xác nhận thanh toán", installed: "Cài đặt lần đầu",
} as const;
type Report = {
  catalog: { total: number; draft: number; published: number; archived: number; listed: number; paused: number };
  installation: { total: number; active: number; inactive: number; unknown_date: number; stores: number; new_stores: number };
  licenses: { total: number; active: number; revoked: number };
  orders: { total: number; pending: number; paid_orders: number; paid: number; value: number; received: number };
  queue: { pending: number; missing_license: number; support: number };
  series: Point[];
  top_installations: { id: string; name: string; installations: number }[];
  ranking: RankedTheme[];
  activity: { at: string; kind: keyof typeof activities; theme: string; store: string | null; actor: string | null }[];
};
const path = "/admin/themes/overview";
const count = new Intl.NumberFormat("vi-VN").format;
const money = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format;
const dateTime = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
const dateLabel = new Intl.DateTimeFormat("vi-VN", { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" });
const localDay = (iso: string) => dateLabel.format(new Date(iso));
const chartDay = new Intl.DateTimeFormat("vi-VN", { day: "numeric", month: "numeric", timeZone: "UTC" });
const unavailable = "Chưa theo dõi";

function Metric({ title, value, detail, rows }: {
  title: string; value: string; detail: string; rows: [string, string][];
}) {
  return <article className="theme-card theme-card-body theme-overview-metric">
    <div className="theme-overview-metric-heading"><h2>{title}</h2>
      <details className="theme-overview-explanation">
        <summary aria-label={`Cách tính ${title}`} title={detail}>?</summary>
        <p>{detail}</p>
      </details>
    </div>
    <strong>{value}</strong>
    <dl>{rows.map(([label, amount]) => <div key={label}><dt>{label}</dt><dd>{amount}</dd></div>)}</dl>
  </article>;
}

function Timeline({ title, points, fields, format = count }: {
  title: string; points: Point[]; fields: { key: Exclude<keyof Point, "date">; label: string }[];
  format?: (value: number) => string;
}) {
  const peak = Math.max(0, ...points.flatMap(point => fields.map(field => point[field.key])));
  const tickStep = Math.max(1, Math.ceil(points.length / 7));
  return <section className="themes-create theme-overview-panel">
    <h2>{title}</h2>
    <ul className="theme-overview-legend">{fields.map(({ key, label }) => <li key={key} data-series={key}>{label}</li>)}</ul>
    {peak === 0 ? <p className="themes-empty">Chưa có dữ liệu trong kỳ.</p> : <>
      <div className="theme-overview-chart" tabIndex={0} aria-label={title}>
        <div className="theme-overview-chart-track" aria-hidden="true">
          {points.map((point, index) => <div className="theme-overview-bucket" key={point.date}>
            <div className="theme-overview-bars">
              {fields.map(({ key, label }) => <span key={key} data-series={key}
                title={`${localDay(point.date)} · ${label} · ${format(point[key])}`}
                style={{ height: `${point[key] / peak * 100}%` }} />)}
            </div>
            <time dateTime={point.date}>{index % tickStep === 0 && chartDay.format(new Date(point.date))}</time>
          </div>)}
        </div>
      </div>
      <details><summary>Xem dữ liệu theo kỳ</summary><div className="theme-overview-scroll">
        <table className="theme-overview-table"><thead><tr><th scope="col">Ngày bắt đầu</th>
          {fields.map(field => <th key={field.key} scope="col">{field.label}</th>)}</tr></thead>
          <tbody>{points.map(point => <tr key={point.date}><th scope="row">{localDay(point.date)}</th>
            {fields.map(field => <td key={field.key}>{format(point[field.key])}</td>)}</tr>)}</tbody>
        </table>
      </div></details>
    </>}
  </section>;
}

export default async function ThemeOverview({ supabase, query }: {
  supabase: Awaited<ReturnType<typeof createClient>>; query: Query;
}) {
  const filters = themeOverviewFilters(query);
  const filterQuery = { period: filters.period, grain: filters.grain, sort: filters.sort, page: String(filters.page),
    ...(filters.period === "custom" ? { from: filters.from, to: filters.to } : {}) };
  return <div className="theme-overview">
    <div className="theme-overview-filter-bar">
      <Form action={path} className="themes-filters">
        <label>Khoảng thời gian<select name="period" defaultValue={filters.period}>
          {Object.entries(overviewPeriods).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <label>Từ ngày (tùy chỉnh)<input name="from" type="date" min="1900-01-01" max={filters.today} defaultValue={filters.from} /></label>
        <label>Đến ngày (tùy chỉnh)<input name="to" type="date" min="1900-01-01" max={filters.today} defaultValue={filters.to} /></label>
        <label>Nhóm theo<select name="grain" defaultValue={filters.grain}><option value="day">Ngày</option><option value="week">Tuần</option><option value="month">Tháng</option></select></label>
        <input type="hidden" name="sort" value={filters.sort} />
        <button type="submit" className="theme-primary">Áp dụng</button>
      </Form>
      <OverviewRefresh />
    </div>
    {filters.valid ? <p className="theme-overview-note">{localDay(filters.from)} – {localDay(filters.to)} · Giờ Việt Nam. Danh mục, giấy phép, lượt đang sử dụng và hàng chờ hiển thị trạng thái hiện tại.</p> :
      <p role="alert" className="theme-feedback is-error">Chọn khoảng ngày hợp lệ, tối đa 366 ngày và kết thúc chậm nhất hôm nay.</p>}
    {filters.valid && <OverviewReport supabase={supabase} filters={filters} filterQuery={filterQuery} />}
  </div>;
}

async function OverviewReport({ supabase, filters, filterQuery }: {
  supabase: Awaited<ReturnType<typeof createClient>>; filters: ReturnType<typeof themeOverviewFilters>; filterQuery: Record<string, string>;
}) {
  const { data, error } = await supabase.rpc("admin_theme_overview_report", {
    start_day: filters.from, end_day: filters.exclusiveEnd, grain: filters.grain,
    sort_by: filters.sort, page_offset: (filters.page - 1) * 10,
  });
  if (error || !data) return <p role="alert" className="theme-feedback is-error">
    Chưa tải được thống kê giao diện. Hãy thử làm mới dữ liệu hoặc kiểm tra cấu hình báo cáo.
  </p>;
  const report = data as Report;
  const { catalog, installation, licenses, orders, queue } = report;
  const licenseRows: [string, string][] = [
    ["Active", count(licenses.active)], ["Pending", unavailable], ["Expired", unavailable],
    ["Suspended", unavailable], ["Revoked", count(licenses.revoked)],
  ];
  return <>
    <div className="theme-metrics">
      <Metric title="Tổng giao diện" detail="Số giao diện hiện có trong danh mục." value={count(catalog.total)}
        rows={[["Bản nháp", count(catalog.draft)], ["Đã phát hành", count(catalog.published)], ["Đã lưu trữ", count(catalog.archived)]]} />
      <Metric title="Đang phân phối" detail="Giao diện đã phát hành, đang hiển thị và Marketplace đang mở." value={count(catalog.listed)}
        rows={[["Tạm ngừng phân phối", count(catalog.paused)]]} />
      <Metric title="Tổng lượt cài đặt" detail="Mỗi cặp cửa hàng và giao diện đã cài được tính một lượt. Bật lại giao diện cũ giữ lượt cài ban đầu." value={count(installation.total)}
        rows={[["Đang bật", count(installation.active)], ["Đã tắt", count(installation.inactive)]]} />
      <Metric title="Cửa hàng sử dụng" detail="Đếm cửa hàng đang hiển thị giao diện hợp lệ. Cửa hàng mới được tính theo ngày cài lần đầu có thể xác minh." value={count(installation.stores)}
        rows={[["Cài lần đầu trong kỳ", count(installation.new_stores)]]} />
      <Metric title="Giấy phép" detail="Active là giấy phép đã cấp và chưa bị thu hồi, kể cả khi cửa hàng chưa kích hoạt giao diện." value={count(licenses.total)} rows={licenseRows} />
      <Metric title="Đơn mua tạo trong kỳ" detail="Chờ và đã thanh toán là trạng thái hiện tại của các đơn tạo trong kỳ. Lượt xác nhận tính theo ngày đối soát, kể cả đơn tạo trước kỳ." value={count(orders.total)}
        rows={[["Chờ thanh toán", count(orders.pending)], ["Đã thanh toán", count(orders.paid_orders)], ["Lượt xác nhận trong kỳ", count(orders.paid)], ["Thất bại", unavailable], ["Đã hoàn tiền", unavailable]]} />
      <Metric title="Doanh thu đã xác nhận" detail="Tiền chuyển khoản đối soát trong kỳ. Tổng giá trị đơn dựa trên ngày tạo." value={money(orders.received)}
        rows={[["Giá trị đơn tạo trong kỳ", money(orders.value)], ["Tiền đã xác nhận", money(orders.received)], ["Tiền hoàn", unavailable], ["Doanh thu thuần", "Chưa đủ dữ liệu"]]} />
    </div>
    <section className="themes-create theme-overview-panel">
      <h2>Công việc cần xử lý</h2>
      <ul className="theme-overview-queue">
        <li><Link href="/admin/themes/licenses#theme-orders">Chuyển khoản chờ xác nhận</Link><strong>{count(queue.pending)}</strong></li>
        <li><Link href="/admin/themes/licenses?orders=all#theme-orders">Đã thanh toán, thiếu giấy phép</Link><strong>{count(queue.missing_license)}</strong></li>
        <li><Link href="/admin/themes/support">Ticket website chưa giải quyết</Link><strong>{count(queue.support)}</strong></li>
      </ul>
      <p className="theme-overview-note">Lỗi phát hành, lỗi kích hoạt, xét duyệt và giấy phép sắp hết hạn hiện chưa có dữ liệu theo dõi.</p>
    </section>
    <div className="theme-overview-panels">
      <Timeline title="Doanh thu đã xác nhận" points={report.series} fields={[{ key: "revenue", label: "Tiền đã xác nhận" }]} format={money} />
      <Timeline title="Đơn mua" points={report.series} fields={[{ key: "orders", label: "Đơn được tạo" }, { key: "paid", label: "Đã thanh toán" }]} />
      <Timeline title="Lượt cài đặt theo thời gian" points={report.series} fields={[{ key: "installations", label: "Lượt cài lần đầu" }]} />
      <section className="themes-create theme-overview-panel"><h2>Trạng thái giấy phép</h2>
        {licenses.total === 0 ? <p className="themes-empty">Chưa có giấy phép.</p> : <ul className="theme-overview-meters">
          {([["Active", licenses.active], ["Revoked", licenses.revoked]] as const).map(([label, value]) => <li key={label}>
            <span>{label} · {count(value)} · {new Intl.NumberFormat("vi-VN", { style: "percent", maximumFractionDigits: 1 }).format(value / licenses.total)}</span>
            <meter min={0} max={licenses.total} value={value} aria-label={label} />
          </li>)}
        </ul>}
        <p className="theme-overview-note">Pending, Expired và Suspended chưa được theo dõi.</p>
      </section>
      <section className="themes-create theme-overview-panel"><h2>Lượt cài đặt theo giao diện</h2>
        {report.top_installations.length === 0 ? <p className="themes-empty">Chưa có lượt cài đặt ghi nhận trong kỳ.</p> :
          <ul className="theme-overview-meters">{report.top_installations.map(row => <li key={row.id}>
            <span>{row.name} · {count(row.installations)}</span><meter min={0} max={report.top_installations[0].installations}
              value={row.installations} aria-label={row.name} />
          </li>)}</ul>}
      </section>
    </div>
    {installation.unknown_date > 0 && <p className="theme-overview-note">
      {count(installation.unknown_date)} lượt cài cũ thiếu ngày cài đầu tiên nên chỉ được tính vào tổng hiện tại.
    </p>}
    <section className="themes-create theme-overview-panel">
      <header className="theme-section-heading"><h2>Giao diện nổi bật</h2>
        <Form action={path} className="theme-overview-sort">
          {Object.entries(filterQuery).filter(([key]) => key !== "sort" && key !== "page")
            .map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
          <label>Sắp xếp theo <select name="sort" defaultValue={filters.sort}>
            <option value="installations">Lượt cài đặt</option><option value="purchases">Lượt mua đã thanh toán</option><option value="revenue">Doanh thu</option>
          </select></label>
          <button className="theme-secondary" type="submit">Sắp xếp</button>
        </Form>
      </header>
      {report.ranking.length === 0 ? <p className="themes-empty">{catalog.total ? "Trang này không có giao diện." : "Chưa có giao diện trong danh mục."}</p> :
        <div className="theme-overview-scroll"><table className="theme-overview-table">
          <thead><tr>{["Giao diện", "Ngành hàng", "Phiên bản", "Lượt cài trong kỳ", "Shop đang dùng", "Lượt mua trong kỳ", "Doanh thu trong kỳ", "Trạng thái"].map(label =>
            <th scope="col" key={label}>{label}</th>)}</tr></thead>
          <tbody>{report.ranking.map(row => <tr key={row.id}>
            <th scope="row"><div className="theme-overview-name"><ThemeCover image={row.preview_url} family={row.primary_family} />
              <Link href={`/admin/themes/studio?edit=${row.id}`}>{row.name}</Link></div></th>
            <td>{themeFamilies[row.primary_family]}</td><td>{row.version ?? "—"}</td>
            <td>{count(row.installations)}</td><td>{count(row.stores)}</td><td>{count(row.purchases)}</td>
            <td>{money(row.revenue)}</td><td>{row.lifecycle === "draft" ? "Bản nháp" : row.lifecycle === "archived" ? "Đã lưu trữ" : row.listed ? "Đang phân phối" : "Tạm ngừng"}</td>
          </tr>)}</tbody>
        </table></div>}
      <ThemePager base={path} query={filterQuery} count={catalog.total} size={10} />
    </section>
    <section className="themes-create theme-overview-panel"><h2>Hoạt động gần đây</h2>
      {report.activity.length === 0 ? <p className="themes-empty">Chưa có hoạt động trong kỳ.</p> :
        <div className="theme-overview-scroll"><table className="theme-overview-table">
          <thead><tr>{["Hoạt động", "Giao diện", "Cửa hàng", "Người thực hiện", "Thời gian", "Trạng thái"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{report.activity.map((event, index) => <tr key={index}>
            <th scope="row">{activities[event.kind]}</th><td>{event.theme}</td><td>{event.store ?? "—"}</td>
            <td>{event.actor ?? "Chưa ghi nhận"}</td><td><time dateTime={event.at}>{dateTime.format(new Date(event.at))}</time></td>
            <td>{event.kind === "ordered" ? "Đã tạo đơn" : event.kind === "paid" ? "Đã đối soát" : "Đã ghi nhận"}</td>
          </tr>)}</tbody>
        </table></div>}
    </section>
  </>;
}

export function ThemeOverviewSkeleton() {
  return <div className="theme-overview" role="status" aria-label="Đang tải thống kê giao diện">
    <div className="theme-metrics">{Array.from({ length: 7 }, (_, index) => <div key={index} className="theme-overview-skeleton" />)}</div>
    <div className="theme-overview-skeleton theme-overview-skeleton-chart" />
  </div>;
}
