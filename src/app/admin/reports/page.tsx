import Link from "next/link";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { findMerchantPlan } from "@/lib/merchant-plans";
import "./reports.css";

export const metadata = { title: "Báo cáo kinh doanh | Quản trị" };
type Report = { month: string; new_stores: number; total_stores: number; active_stores: number; revenue: number; basic_revenue: number; plus_revenue: number; upgrade_count: number; payment_count: number; active_basic: number; active_plus: number; monthly_revenue: { month: string; amount: number }[] };
const currency = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" });
const number = new Intl.NumberFormat("vi-VN");
const percent = new Intl.NumberFormat("vi-VN", { style: "percent", maximumFractionDigits: 1 });
const vietnamDate = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
function currentMonth() { return vietnamDate.format(new Date()).slice(0, 7); }
function monthLabel(value: string) { return `${value.slice(5, 7)}/${value.slice(0, 4)}`; }

export default async function BusinessReports({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await connection();
  const [supabase, query] = await Promise.all([createClient(), searchParams]);
  await requirePlatformAdminAccess(supabase);
  const current = currentMonth();
  const valid = typeof query.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month) && query.month >= "2010-01" && query.month <= current;
  const month = valid ? query.month! : current;
  const result = await supabase.rpc("get_admin_business_report", { report_month: `${month}-01` });
  const data = result.data as Report | null;
  const estimatedMrr = data ? Number(data.active_basic) * (findMerchantPlan("basic")?.amount ?? 0) + Number(data.active_plus) * (findMerchantPlan("plus")?.amount ?? 0) : 0;
  const activeRatio = data && Number(data.total_stores) > 0 ? Number(data.active_stores) / Number(data.total_stores) : null;
  const series = data?.monthly_revenue ?? [];
  const peak = Math.max(1, ...series.map((item) => Number(item.amount)));
  const unknowns = [
    { label: "Tỷ lệ cửa hàng rời bỏ (Churn Rate)", description: "Chưa có lịch sử đăng ký và định nghĩa thời điểm rời bỏ." },
    { label: "Chuyển đổi dùng thử sang trả phí", description: "Hệ thống chưa ghi nhận thời gian và kết quả dùng thử." },
    { label: "Số lượng hủy gói", description: "Chưa có sự kiện hủy đăng ký; hủy mã thanh toán không đồng nghĩa hủy gói." },
  ];
  return <main className="admin-content reports-page"><header className="reports-heading"><span aria-hidden="true">▥</span><div><div className="dashboard-kicker">BÁO CÁO NỀN TẢNG</div><h1 className="admin-page-title">Báo cáo kinh doanh</h1><p>Theo dõi cửa hàng và doanh thu gói dịch vụ.</p></div></header>
    <div className="reports-note"><strong>Phạm vi số liệu</strong><p>Doanh thu là phí gói đã xác nhận theo ngày nhận tiền, giờ Việt Nam; không bao gồm doanh thu bán hàng của cửa hàng hoặc giao dịch cần đối soát. Cửa hàng mới được tính từ dữ liệu còn tồn tại. Trạng thái hoạt động và số gói còn hạn được tính tại thời điểm xem.</p></div>
    <form className="reports-filter" method="get"><label>Tháng báo cáo<input type="month" name="month" min="2010-01" max={current} defaultValue={month} required /></label><button type="submit">Xem báo cáo</button></form>
    {query.month !== undefined && !valid && <p className="admin-error" role="alert">Tháng không hợp lệ; đang hiển thị tháng hiện tại.</p>}
    {result.error || !data ? <p className="admin-error" role="alert">Chưa tải được báo cáo. Cần chạy migration 202611180014_admin_business_report.sql sau các migration gói dịch vụ.</p> : <>
      <section className="reports-cards" aria-label="Chỉ số kinh doanh"><article><span aria-hidden="true">＋</span><div><small>CỬA HÀNG MỚI</small><b>{number.format(data.new_stores)}</b><p>Đăng ký trong tháng {monthLabel(data.month)}</p></div></article><article><span aria-hidden="true">◉</span><div><small>TỶ LỆ HOẠT ĐỘNG</small><b>{activeRatio === null ? "—" : percent.format(activeRatio)}</b><p>{number.format(data.active_stores)} / {number.format(data.total_stores)} cửa hàng hiện có</p></div></article><article><span aria-hidden="true">₫</span><div><small>DOANH THU THÁNG</small><b>{currency.format(data.revenue)}</b><p>{number.format(data.payment_count)} giao dịch đã xác nhận</p></div></article><article><span aria-hidden="true">↗</span><div><small>SỐ LẦN NÂNG CẤP</small><b>{number.format(data.upgrade_count)}</b><p>Thanh toán nâng cấp hợp lệ trong tháng</p></div></article></section>
      <div className="reports-grid"><section className="reports-panel reports-chart"><div className="reports-panel-heading"><div><h2>Doanh thu theo tháng</h2><p>12 tháng đến tháng {monthLabel(data.month)}</p></div><Link href="/admin/plan-payments">Xem giao dịch →</Link></div><div className="reports-chart-scroll"><div className="reports-bars">{series.map((item) => <div className="reports-bar" key={item.month} aria-label={`Tháng ${monthLabel(item.month)}, ${currency.format(item.amount)}`}><div className="reports-bar-column"><span title={currency.format(item.amount)} style={{ height: `${Math.max(Number(item.amount) > 0 ? 2 : 0, Number(item.amount) / peak * 100)}%` }} /></div><small>{monthLabel(item.month)}</small></div>)}</div></div><details className="reports-chart-details"><summary>Xem số tiền từng tháng</summary><ul>{series.map((item) => <li key={item.month}><span>{monthLabel(item.month)}</span><b>{currency.format(item.amount)}</b></li>)}</ul></details></section>
        <div className="reports-side"><section className="reports-panel"><div className="reports-panel-heading"><div><h2>Doanh thu theo gói</h2><p>Tháng {monthLabel(data.month)}</p></div></div><div className="reports-breakdown"><div><span>Gói Cơ bản</span><b>{currency.format(data.basic_revenue)}</b></div><div><span>Gói Nâng cao</span><b>{currency.format(data.plus_revenue)}</b></div><div><span>Tổng phí đã xác nhận</span><b>{currency.format(data.revenue)}</b></div></div></section>
          <section className="reports-panel"><div className="reports-panel-heading"><div><h2>Phương thức thanh toán</h2><p>Tháng {monthLabel(data.month)}</p></div></div><div className="reports-breakdown"><div><span>Chuyển khoản QR · SePay</span><b>{currency.format(data.revenue)}</b></div></div><p className="reports-explanation">Luồng thanh toán gói đã xác nhận hiện dùng giao dịch SePay; các khoản cần đối soát không được tính.</p></section>
        </div>
      </div>
      <section className="reports-panel reports-mrr"><div className="reports-panel-heading"><div><h2>Ước tính doanh thu theo gói còn hạn</h2><p>Tính tại thời điểm xem, không phụ thuộc tháng đang chọn.</p></div></div><div className="reports-recurring"><div><small>MRR THAM KHẢO</small><strong>{currency.format(estimatedMrr)}</strong></div><div><small>ARR THAM KHẢO</small><strong>{currency.format(estimatedMrr * 12)}</strong></div><div><small>GÓI CÒN HIỆU LỰC</small><strong>{number.format(Number(data.active_basic) + Number(data.active_plus))}</strong></div></div><p className="reports-explanation">Ước tính bằng số tài khoản có gói còn hạn nhân giá niêm yết tháng hiện tại; ARR bằng 12 lần số này. Hệ thống gia hạn thủ công, nên đây không phải doanh thu định kỳ thực thu hoặc cam kết gia hạn. Không tính cửa hàng cũ chưa liên kết tài khoản thanh toán.</p></section>
      <section className="reports-panel"><div className="reports-panel-heading"><div><h2>Chỉ số chưa đủ dữ liệu</h2><p>Không hiển thị số 0 khi hệ thống chưa ghi nhận được.</p></div></div><div className="reports-unknown">{unknowns.map((item) => <div key={item.label}><div><b>{item.label}</b><p>{item.description}</p></div><span>Chưa có dữ liệu</span></div>)}</div></section>
    </>}
  </main>;
}
