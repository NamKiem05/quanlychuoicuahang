import Link from "next/link";
import { getMerchantContext } from "../data";
import { markNoticeRead } from "./actions";
import "@/app/platform-notifications.css";

const categories: Record<string, string> = { general: "Thông báo chung", maintenance: "Bảo trì", feature: "Cập nhật tính năng", payment: "Thanh toán", expiry: "Hết hạn dịch vụ" };
const dateFormat = new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
export default async function MerchantNotifications({ searchParams }: { searchParams: Promise<{ message?: string; page?: string }> }) {
  const [{ supabase, store, userId }, query] = await Promise.all([getMerchantContext(), searchParams]);
  const page = typeof query.page === "string" && /^[1-9]\d{0,5}$/.test(query.page) ? Number(query.page) : 1;
  const start = (page - 1) * 25;
  if (!store) return <main className="admin-content"><h1 className="admin-page-title">Thông báo</h1><p className="dashboard-intro">Bạn cần có cửa hàng để nhận thông báo.</p></main>;
  const notices = await supabase.from("platform_notifications").select("id, title, body, category, created_at, platform_notification_recipients!inner(store_id)", { count: "exact" }).eq("platform_notification_recipients.store_id", store.id).order("created_at", { ascending: false }).order("id").range(start, start + 24);
  const ids = (notices.data ?? []).map((notice) => notice.id);
  const reads = ids.length ? await supabase.from("platform_notification_reads").select("notification_id").eq("store_id", store.id).eq("user_id", userId).in("notification_id", ids) : { data: [], error: null };
  const readSet = new Set((reads.data ?? []).map((read) => read.notification_id));
  return <main className="admin-content platform-notices"><header className="platform-notice-heading"><span aria-hidden="true">♧</span><div><div className="dashboard-kicker">TIN TỪ NỀN TẢNG</div><h1 className="admin-page-title">Thông báo</h1><p>Cập nhật thông tin và dịch vụ dành cho cửa hàng.</p></div></header>
    {query.message && <p className="admin-error" role="alert">Không cập nhật được trạng thái đã đọc. Hãy thử lại.</p>}
    <section className="platform-notice-card"><div className="platform-notice-card-heading"><div><h2>Thông báo của cửa hàng</h2><p>{notices.error ? "Không tải được" : `${(notices.count ?? 0).toLocaleString("vi-VN")} thông báo`}</p></div></div>
      {notices.error || reads.error ? <p className="admin-error" role="alert">Chưa tải được thông báo. Kiểm tra migration 202611180011_platform_notifications.sql.</p> : notices.data?.length ? <div className="platform-notice-list">{notices.data.map((notice) => <article className={`platform-notice-item${readSet.has(notice.id) ? "" : " is-unread"}`} key={notice.id}><div className="platform-notice-item-header"><div><span className={`platform-notice-kind is-${notice.category}`}>{categories[notice.category] ?? notice.category}</span>{!readSet.has(notice.id) && <span className="platform-notice-new">Chưa đọc</span>}<h3>{notice.title}</h3></div><time dateTime={notice.created_at}>{dateFormat.format(new Date(notice.created_at))}</time></div><p>{notice.body}</p>{!readSet.has(notice.id) && <form action={markNoticeRead}><input type="hidden" name="notice_id" value={notice.id} /><button className="platform-notice-read" type="submit">Đánh dấu đã đọc</button></form>}</article>)}</div> : <p className="platform-notice-empty">Chưa có thông báo nào.</p>}
      {!notices.error && (page > 1 || start + 25 < (notices.count ?? 0)) && <nav className="platform-notice-pagination">{page > 1 && <Link href={`/dashboard/notifications?page=${page - 1}`}>← Trang trước</Link>}<span>Trang {page}</span>{start + 25 < (notices.count ?? 0) && <Link href={`/dashboard/notifications?page=${page + 1}`}>Trang sau →</Link>}</nav>}
    </section>
  </main>;
}
