import type { createClient } from "@/lib/supabase/server";
import { connection } from "next/server";
import Link from "next/link";
import { getPlatformPlanRevenue } from "@/lib/platform-plan-revenue";
import "./overview-revenue.css";

type RevenueDay = {
  revenue_day: string;
  revenue_vnd: number;
  paid_orders: number;
};

export type RevenueSearchParams = {
  revenue_from?: string | string[];
  revenue_to?: string | string[];
  revenue_period?: string | string[];
};

const currency = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" });
const dayLabel = new Intl.DateTimeFormat("vi-VN", { day: "numeric", month: "numeric", timeZone: "UTC" });
const fullDateLabel = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeZone: "UTC" });
const vietnamDate = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
const axisNumber = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });
const changeFormat = new Intl.NumberFormat("vi-VN", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" });
const dayMs = 86_400_000;

function Metric({ label, value, current, previous, caption = "So với kỳ trước", inverse = false }: {
  label: string;
  value: string;
  current: number | null;
  previous: number | null;
  caption?: string;
  inverse?: boolean;
}) {
  const change = current !== null && previous !== null && previous > 0 ? (current - previous) / previous : null;
  return (
    <div className="overview-revenue-metric">
      <span>{label}</span>
      {change !== null && (
        <span className="overview-revenue-change" data-tone={change === 0 ? "neutral" : (change > 0) !== inverse ? "positive" : "negative"}>
          {changeFormat.format(change)}
        </span>
      )}
      <strong>{value}</strong>
      <small>{change === null && current !== null ? `${caption} · Chưa có tỷ lệ so sánh` : caption}</small>
    </div>
  );
}

function readDate(value: string | string[] | undefined) {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function axisLabel(value: number) {
  if (value >= 1_000_000_000) return `${axisNumber.format(value / 1_000_000_000)} tỷ`;
  if (value >= 1_000_000) return `${axisNumber.format(value / 1_000_000)} triệu`;
  if (value >= 1_000) return `${axisNumber.format(value / 1_000)} nghìn`;
  return axisNumber.format(value);
}

export default async function OverviewRevenue({
  supabase,
  storeId,
  query,
  path,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  storeId?: string;
  query: RevenueSearchParams;
  path: "/admin" | "/dashboard";
}) {
  await connection();
  const today = vietnamDate.format(new Date());
  const defaultFrom = new Date(Date.parse(today) - 6 * dayMs).toISOString().slice(0, 10);
  const customRange = query.revenue_from !== undefined || query.revenue_to !== undefined;
  const from = readDate(query.revenue_from);
  const to = readDate(query.revenue_to);
  const rangeDays = from && to ? (to.valueOf() - from.valueOf()) / dayMs + 1 : 0;
  const rangeError = customRange && (rangeDays < 1 || rangeDays > 366);
  const fromDate = from?.toISOString().slice(0, 10) ?? defaultFrom;
  const toDate = to?.toISOString().slice(0, 10) ?? today;
  const nextDate = new Date(Date.parse(toDate) + dayMs).toISOString().split("T")[0];
  const params = { p_store_id: storeId ?? null };
  const showMetrics = path === "/dashboard";
  const period = !showMetrics && !customRange && typeof query.revenue_period === "string" && ["day", "week", "month", "year"].includes(query.revenue_period) ? query.revenue_period : "day";
  const presetStart = new Date(`${today}T00:00:00Z`);
  if (period === "week") presetStart.setUTCDate(presetStart.getUTCDate() - ((presetStart.getUTCDay() + 6) % 7) - 77);
  if (period === "month") presetStart.setUTCMonth(presetStart.getUTCMonth() - 11, 1);
  if (period === "year") presetStart.setUTCFullYear(presetStart.getUTCFullYear() - 4, 0, 1);
  const chartFrom = !customRange && !showMetrics && period !== "day" ? presetStart.toISOString().slice(0, 10) : fromDate;
  const previousFrom = new Date(Date.parse(fromDate) - (customRange && !rangeError ? rangeDays : 7) * dayMs).toISOString().slice(0, 10);
  const previousTo = new Date(Date.parse(fromDate) - dayMs).toISOString().slice(0, 10);
  function countOrders(start: string, end: string, cancelled = false) {
    const orders = supabase.from("orders").select("id", { count: "exact", head: true })
      .gte("created_at", `${start}T00:00:00+07:00`).lt("created_at", `${end}T00:00:00+07:00`);
    if (storeId) orders.eq("store_id", storeId);
    if (cancelled) orders.eq("status", "cancelled");
    return orders;
  }

  const emptyCount = { count: null, error: null };
  const planRevenue = !showMetrics && !rangeError ? await getPlatformPlanRevenue(supabase, chartFrom, nextDate) : null;
  const [{ data, error: orderRevenueError }, { count: cancelledCount, error: cancelledError }, orderCount, priorRevenue, priorOrders, priorCancelled] = rangeError || !showMetrics
    ? [{ data: null, error: null }, emptyCount, emptyCount, null, emptyCount, emptyCount]
    : await Promise.all([
      supabase.rpc("get_overview_revenue", customRange ? { ...params, p_start_date: fromDate, p_end_date: toDate } : params),
      countOrders(fromDate, nextDate, true),
      countOrders(fromDate, nextDate),
      supabase.rpc("get_overview_revenue", { ...params, p_start_date: previousFrom, p_end_date: previousTo }),
      countOrders(previousFrom, fromDate),
      countOrders(previousFrom, fromDate, true),
    ]);
  const error = planRevenue?.error ?? orderRevenueError;
  const orderDays = (data ?? []) as RevenueDay[];
  const dailyDays = planRevenue?.days ?? orderDays;
  const grouped = new Map<string, { revenue_day: string; revenue_vnd: number }>();
  for (const day of dailyDays) {
    let key = day.revenue_day;
    if (period === "week") {
      const date = new Date(`${key}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
      key = date.toISOString().slice(0, 10);
    } else if (period === "month") key = `${key.slice(0, 7)}-01`;
    else if (period === "year") key = `${key.slice(0, 4)}-01-01`;
    const existing = grouped.get(key);
    if (existing) existing.revenue_vnd += day.revenue_vnd;
    else grouped.set(key, { revenue_day: key, revenue_vnd: day.revenue_vnd });
  }
  const days = [...grouped.values()];
  const total = days.reduce((sum, day) => sum + day.revenue_vnd, 0);
  const orders = orderDays.reduce((sum, day) => sum + day.paid_orders, 0);
  const paidPlans = planRevenue?.days.reduce((sum, day) => sum + day.paid_payments, 0) ?? 0;
  const upgradeTotal = planRevenue?.days.reduce((sum, day) => sum + day.upgrade_revenue_vnd, 0) ?? 0;
  const priorDays = priorRevenue?.error ? null : priorRevenue?.data as RevenueDay[] | null | undefined;
  const priorTotal = priorDays?.reduce((sum, day) => sum + day.revenue_vnd, 0) ?? null;
  const priorPaid = priorDays?.reduce((sum, day) => sum + day.paid_orders, 0) ?? null;
  const formatCount = (count: number | null) => count?.toLocaleString("vi-VN") ?? "—";
  const peak = Math.max(0, ...days.map((day) => day.revenue_vnd));
  const targetStep = Math.max(1, peak / 4 || 250_000);
  const magnitude = 10 ** Math.floor(Math.log10(targetStep));
  const step = ([1, 2, 2.5, 5, 10].find((factor) => factor * magnitude >= targetStep) ?? 10) * magnitude;
  const ticks = [8, 29, 50, 71, 92].map((y, index) => ({ y, value: (4 - index) * step }));
  const points = days.map((day, index) => ({
    ...day,
    label: period === "year" ? day.revenue_day.slice(0, 4) : period === "month" ? `${day.revenue_day.slice(5, 7)}/${day.revenue_day.slice(0, 4)}` : dayLabel.format(new Date(day.revenue_day)),
    fullLabel: period === "year" ? day.revenue_day.slice(0, 4) : period === "month" ? `${day.revenue_day.slice(5, 7)}/${day.revenue_day.slice(0, 4)}` : fullDateLabel.format(new Date(day.revenue_day)),
    x: (index + 0.5) * 100 / days.length,
    y: 92 - day.revenue_vnd / (4 * step) * 84,
  }));

  return (
    <section id="overview-revenue" className="overview-revenue-card" aria-labelledby="overview-revenue-title">
      <header className="overview-revenue-heading">
        <div>
          <h2 id="overview-revenue-title">{showMetrics ? "Doanh thu" : "Doanh thu gói dịch vụ"}</h2>
          {!customRange && <span>{period === "day" ? "7 ngày gần nhất" : period === "week" ? "12 tuần gần đây" : period === "month" ? "12 tháng gần đây" : "5 năm gần đây"}</span>}
        </div>
        <form className="overview-revenue-filter" method="get" action={`${path}#overview-revenue`}>
          <label>Từ ngày<input type="date" name="revenue_from" defaultValue={fromDate} required /></label>
          <label>Đến ngày<input type="date" name="revenue_to" defaultValue={toDate} required /></label>
          <button type="submit">Áp dụng</button>
          {customRange && <a href={`${path}#overview-revenue`}>Về 7 ngày gần nhất</a>}
        </form>
      </header>
      {!showMetrics && <nav className="overview-revenue-periods" aria-label="Chu kỳ biểu đồ doanh thu">{([ ["day", "Ngày"], ["week", "Tuần"], ["month", "Tháng"], ["year", "Năm"] ] as const).map(([value, label]) => <Link key={value} href={`/admin?revenue_period=${value}#overview-revenue`} aria-current={!customRange && period === value ? "true" : undefined}>{label}</Link>)}</nav>}
      {rangeError && <p className="overview-revenue-error" role="alert">Chọn khoảng ngày hợp lệ, tối đa 366 ngày. Ngày kết thúc phải từ ngày bắt đầu trở đi.</p>}
      {error && <p className="overview-revenue-error" role="alert">Chưa tải được số liệu doanh thu.</p>}
      {!rangeError && !error && (
        <>
          {showMetrics ? (
            <div className="overview-revenue-metrics">
              <Metric label="Tổng doanh thu" value={currency.format(total)} current={total} previous={priorTotal} />
              <Metric label="Tổng đơn hàng" value={formatCount(orderCount.count)} current={orderCount.count} previous={priorOrders.count} caption={orderCount.error ? "Chưa tải được số đơn" : "Theo ngày đặt đơn"} />
              <Metric label="Đơn đã thanh toán" value={formatCount(orders)} current={orders} previous={priorPaid} />
              <Metric label="Đơn đã hủy" value={formatCount(cancelledCount)} current={cancelledCount} previous={priorCancelled.count} caption={cancelledError ? "Chưa tải được số đơn đã hủy" : "Theo ngày đặt đơn"} inverse />
            </div>
          ) : (
            <div className="overview-revenue-summary">
              <div><span>Tổng phí đã thu</span><strong>{currency.format(total)}</strong></div>
              <div><span>Mua mới và gia hạn</span><strong>{currency.format(total - upgradeTotal)}</strong></div>
              <div><span>Nâng cấp gói</span><strong>{currency.format(upgradeTotal)}</strong></div>
            </div>
          )}
          <h3 className="overview-revenue-chartTitle">Doanh thu theo {period === "week" ? "tuần" : period === "month" ? "tháng" : period === "year" ? "năm" : "ngày"} <span>(₫)</span></h3>
          {(showMetrics ? orders : paidPlans) === 0 && <p className="overview-revenue-empty">{showMetrics ? "Chưa có đơn đã thanh toán trong kỳ này." : "Chưa có giao dịch gói đã xác nhận trong kỳ này."}</p>}
          <div className="overview-revenue-scroll">
            <div className="overview-revenue-chart" style={{ minWidth: points.length > 7 ? 62 + points.length * 38 : undefined }}>
              <div className="overview-revenue-axis" aria-hidden="true">
                {ticks.map(({ y, value }) => <span key={y} style={{ top: `${y}%` }}>{axisLabel(value)}</span>)}
              </div>
              <div className="overview-revenue-plot">
                <svg className="overview-revenue-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  {ticks.map(({ y }) => (
                    <line key={y} x1="0" x2="100" y1={y} y2={y} vectorEffect="non-scaling-stroke" />
                  ))}
                  <polyline points={points.map(({ x, y }) => `${x},${y}`).join(" ")} vectorEffect="non-scaling-stroke" />
                </svg>
                {points.map(({ revenue_day, revenue_vnd, fullLabel, x, y }) => {
                  const amount = currency.format(revenue_vnd);
                  return (
                    <button
                      className="overview-revenue-point"
                      type="button"
                      key={revenue_day}
                      style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${x * 9}ms` }}
                      aria-label={`${period === "week" ? "Tuần bắt đầu" : period === "month" ? "Tháng" : period === "year" ? "Năm" : "Ngày"} ${fullLabel}, ${amount}`}
                      data-tooltip-below={y < 35}
                    >
                      <span className="overview-revenue-tooltip" aria-hidden="true">
                        <span>{period === "week" ? "Tuần từ" : period === "month" ? "Tháng" : period === "year" ? "Năm" : "Ngày"} {fullLabel}</span>
                        <strong>{amount}</strong>
                      </span>
                    </button>
                  );
                })}
              </div>
              <ol className="overview-revenue-dates" aria-label="Ngày trên biểu đồ" style={{ gridTemplateColumns: `repeat(${Math.max(1, points.length)}, minmax(0, 1fr))` }}>
                {points.map((day) => <li key={day.revenue_day}><time dateTime={day.revenue_day}>{day.label}</time></li>)}
              </ol>
            </div>
          </div>
          <details className="overview-revenue-daily">
            <summary>Xem chi tiết doanh thu</summary>
            <ul>
              {points.map((day) => (
                <li key={day.revenue_day}>
                  <time dateTime={day.revenue_day}>{day.label}</time>
                  <strong>{currency.format(day.revenue_vnd)}</strong>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
      <p className="overview-revenue-note">{showMetrics
        ? "Ghi nhận theo ngày xác nhận thanh toán, giờ Việt Nam. Đơn hủy hoặc bị từ chối được loại khỏi thống kê."
        : "Tính phí đã xác nhận theo ngày nhận tiền, giờ Việt Nam. Giao dịch cần đối soát được loại khỏi thống kê."}</p>
      {!showMetrics && <Link className="overview-revenue-payments-link" href="/admin/plan-payments">Xem giao dịch thanh toán gói →</Link>}
    </section>
  );
}
