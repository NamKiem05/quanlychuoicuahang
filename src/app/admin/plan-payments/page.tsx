import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findMerchantPlan, formatPlanAmount } from "@/lib/merchant-plans";
import SidebarIcon from "@/app/sidebar-icon";
import "./plan-payments.css";

export const metadata = { title: "Thanh toán gói | Quản trị" };
export const instant = false;

const pageSize = 25;
const fields = "id, user_id, plan, amount_vnd, transfer_code, status, created_at, paid_at, sepay_transaction_id, valid_until";
const statuses = { pending: "Chờ thanh toán", approved: "Đã nhận tiền", expired: "Hết hạn", cancelled: "Đã hủy", needs_review: "Cần đối soát" };
const dates = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });

function formatDate(value: string | null) {
  return value ? dates.format(new Date(value)) : "—";
}

export default async function AdminPlanPayments({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const [supabase, query] = await Promise.all([createClient(), searchParams]);
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (isAdmin !== true) redirect("/admin");

  const search = typeof query.q === "string" ? query.q.trim().replace(/[^a-z0-9-]/gi, "").slice(0, 120) : "";
  const status = typeof query.status === "string" && Object.hasOwn(statuses, query.status) ? query.status : "";
  const page = typeof query.page === "string" && /^\d{1,6}$/.test(query.page) ? Math.max(1, Number(query.page)) : 1;
  const first = (page - 1) * pageSize;

  function loadPayments(columns: string) {
    let request = supabase.from("merchant_plan_payments").select(columns, { count: "exact" });
    if (search) request = request.or(`transfer_code.ilike.${search},sepay_transaction_id.eq.${search}`);
    if (status) request = request.eq("status", status);
    return request.order("created_at", { ascending: false }).order("id").range(first, first + pageSize - 1);
  }

  const upgradeFields = `${fields}, upgrade_amount_vnd, upgrade_expires_at`;
  const extended = await loadPayments(`${upgradeFields}, received_amount_vnd`);
  const withUpgrades = extended.error?.code === "42703" ? await loadPayments(upgradeFields) : extended;
  const result = withUpgrades.error?.code === "42703" ? await loadPayments(fields) : withUpgrades;
  type Payment = {
    id: string; user_id: string; plan: string; amount_vnd: number; transfer_code: string;
    status: keyof typeof statuses; created_at: string; paid_at: string | null;
    sepay_transaction_id: string | null; valid_until: string | null;
    upgrade_amount_vnd?: number | null; upgrade_expires_at?: string | null;
    received_amount_vnd?: number | null;
  };
  const rows = (result.data ?? []) as unknown as Payment[];
  const owners = [...new Set(rows.map((row) => row.user_id))];
  const { data: profiles } = owners.length
    ? await supabase.from("profiles").select("id, display_name").in("id", owners)
    : { data: [] };
  const names = new Map(profiles?.map((profile) => [profile.id, profile.display_name]));

  function pageHref(nextPage: number) {
    return `/admin/plan-payments?${new URLSearchParams({ q: search, status, page: String(nextPage) })}`;
  }

  return (
    <main className="admin-content plan-payments">
      <header className="plan-payments-heading">
        <span className="plan-payments-icon"><SidebarIcon name="payment" /></span>
        <div>
          <h1 className="admin-page-title">Thanh toán gói</h1>
          <p className="dashboard-intro">Đối soát phí dịch vụ theo mã chuyển khoản hoặc mã giao dịch SePay.</p>
        </div>
      </header>
      <section className="plan-payments-panel" aria-labelledby="plan-payments-results">
        <form className="dashboard-form plan-payments-filters" action="/admin/plan-payments">
          <label>Mã giao dịch
            <span className="plan-payments-search"><SidebarIcon name="search" /><input name="q" type="search" defaultValue={search} maxLength={120} placeholder="Nhập mã GGP hoặc mã SePay" /></span>
          </label>
          <label>Trạng thái<select name="status" defaultValue={status}>
            <option value="">Tất cả trạng thái</option>
            {Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          <div className="plan-payments-filter-actions">
            <button className="plan-payments-submit" type="submit">Lọc giao dịch</button>
            {(search || status) && <Link href="/admin/plan-payments">Xóa lọc</Link>}
          </div>
        </form>
        <header className="plan-payments-results">
          <h2 id="plan-payments-results">Giao dịch</h2>
          {!result.error && <span>{(result.count ?? 0).toLocaleString("vi-VN")} kết quả</span>}
        </header>
        {result.error ? <p className="plan-payments-empty" role="alert">Chưa tải được giao dịch thanh toán gói.</p> : rows.length === 0 ? (
          <div className="plan-payments-empty"><SidebarIcon name="orders" /><p>{search || status ? "Không có giao dịch khớp bộ lọc." : "Chưa có giao dịch thanh toán gói."}</p></div>
        ) : (
          <div className="plan-payments-scroll" tabIndex={0} role="region" aria-label="Bảng giao dịch thanh toán gói">
            <table className="plan-payments-table">
              <thead><tr><th scope="col">Chủ cửa hàng</th><th scope="col">Gói dịch vụ</th><th scope="col">Số tiền</th><th scope="col">Mã giao dịch</th><th scope="col">Trạng thái</th><th scope="col">Ngày nhận tiền</th><th scope="col">Hạn gói</th></tr></thead>
              <tbody>
                {rows.map((row) => {
                  const late = row.paid_at && row.upgrade_expires_at && Date.parse(row.paid_at) >= Date.parse(row.upgrade_expires_at);
                  const expected = row.upgrade_amount_vnd ?? row.amount_vnd;
                  return (
                    <tr key={row.id}>
                      <th scope="row" className="plan-payments-owner">{names.get(row.user_id) || <code>{row.user_id}</code>}</th>
                      <td><strong>{findMerchantPlan(row.plan)?.name ?? row.plan}</strong>{row.upgrade_amount_vnd != null && <small>Nâng cấp</small>}</td>
                      <td className="plan-payments-amount">{formatPlanAmount(row.received_amount_vnd ?? expected)}{row.received_amount_vnd != null && row.received_amount_vnd !== expected && <small>Yêu cầu {formatPlanAmount(expected)}</small>}</td>
                      <td><code className="plan-payments-code">{row.transfer_code}</code>{row.sepay_transaction_id && <small>SePay {row.sepay_transaction_id}</small>}{["pending", "approved"].includes(row.status) && !late && <small><Link href={`/admin/invoices/new?payment=${row.id}`}>Tạo chứng từ →</Link></small>}</td>
                      <td><span className="plan-payments-status" data-status={late ? "late" : row.status}>{late ? "Cần đối soát" : statuses[row.status]}</span>{late && <small>Nhận tiền sau hạn</small>}{row.status === "needs_review" && <small>Nhận tiền sau khi hủy mã</small>}</td>
                      <td>{formatDate(row.paid_at)}</td>
                      <td>{formatDate(row.valid_until ?? row.upgrade_expires_at ?? null)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!result.error && (page > 1 || first + pageSize < (result.count ?? 0)) && (
          <nav className="plan-payments-pagination" aria-label="Phân trang giao dịch">
            <span>Trang {page}</span>
            <div>
              {page > 1 && <Link href={pageHref(page - 1)}>← Trang trước</Link>}
              {first + pageSize < (result.count ?? 0) && <Link href={pageHref(page + 1)}>Trang sau →</Link>}
            </div>
          </nav>
        )}
      </section>
    </main>
  );
}
