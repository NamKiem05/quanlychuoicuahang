import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import NotificationForm from "./notification-form";
import "@/components/admin/platform-notifications.css";

const categories: Record<string, string> = { general: "Thông báo chung", maintenance: "Bảo trì", feature: "Cập nhật tính năng", payment: "Thanh toán", expiry: "Hết hạn dịch vụ" };
const dateFormat = new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
const messages: Record<string, string> = { sent: "Đã gửi thông báo trong ứng dụng.", invalid: "Thông tin thông báo chưa hợp lệ.", disabled: "Loại thông báo này đang bị tắt trong cấu hình hệ thống.", "too-long": "Nội dung vượt giới hạn cấu hình trong Cấu hình hệ thống.", "no-recipients": "Không có cửa hàng phù hợp với đối tượng đã chọn; chưa gửi thông báo.", failed: "Chưa gửi được thông báo. Kiểm tra quyền và cơ sở dữ liệu." };
export default async function AdminNotifications({ searchParams }: { searchParams: Promise<{ message?: string; page?: string }> }) {
  const [supabase, query] = await Promise.all([createClient(), searchParams]);
  await requirePlatformAdminAccess(supabase);
  const page = typeof query.page === "string" && /^[1-9]\d{0,5}$/.test(query.page) ? Number(query.page) : 1;
  const start = (page - 1) * 25;
  async function loadStores() {
    const rows: { id: string; name: string }[] = [];
    for (let offset = 0; ; offset += 1000) {
      const result = await supabase.from("stores").select("id, name").order("name").order("id").range(offset, offset + 999);
      if (result.error) return { data: rows, error: result.error };
      rows.push(...result.data);
      if (result.data.length < 1000) return { data: rows, error: null };
    }
  }
  const [stores, notices, templateResult] = await Promise.all([
    loadStores(),
    supabase.from("platform_notifications").select("id, title, body, category, audience, target_plan, created_at, platform_notification_recipients(count)", { count: "exact" }).order("created_at", { ascending: false }).order("id").range(start, start + 24),
    supabase.from("platform_notification_settings").select("maintenance_title, maintenance_body, payment_title, payment_body").eq("id", true).maybeSingle(),
  ]);
  return <main className="admin-content platform-notices"><header className="platform-notice-heading"><span aria-hidden="true">♧</span><div><div className="dashboard-kicker">CHĂM SÓC KHÁCH HÀNG</div><h1 className="admin-page-title">Quản lý thông báo</h1><p>Gửi thông báo đến cửa hàng trong ứng dụng.</p></div></header>
    <div className="platform-notice-note"><strong>Thông báo trong ứng dụng</strong><p>Loại thanh toán và hết hạn hiện được gửi thủ công. Các thông báo này chưa tự phát sinh từ giao dịch hoặc lịch hết hạn.</p></div>
    {query.message && <p className={query.message === "sent" ? "platform-notice-success" : "admin-error"} role="status">{messages[query.message]}</p>}
    {stores.error && <p className="admin-error" role="alert">Không tải được danh sách cửa hàng để chọn người nhận.</p>}
    <section className="platform-notice-card"><div className="platform-notice-card-heading"><div><h2>Tạo thông báo</h2><p>Chọn đối tượng, loại thông báo và nội dung.</p></div></div>{!stores.error && <NotificationForm stores={stores.data ?? []} templates={templateResult.data ?? null} />}</section>
    <section className="platform-notice-card"><div className="platform-notice-card-heading"><div><h2>Lịch sử thông báo</h2><p>{notices.error ? "Không tải được" : `${(notices.count ?? 0).toLocaleString("vi-VN")} thông báo`}</p></div></div>
      {notices.error ? <p className="admin-error" role="alert">Chưa tải được thông báo. Cần chạy migration 202611180011_platform_notifications.sql.</p> : notices.data?.length ? <div className="platform-notice-list">{notices.data.map((notice) => <article className="platform-notice-item" key={notice.id}><div className="platform-notice-item-header"><div><span className={`platform-notice-kind is-${notice.category}`}>{categories[notice.category] ?? notice.category}</span><h3>{notice.title}</h3></div><time dateTime={notice.created_at}>{dateFormat.format(new Date(notice.created_at))}</time></div><p>{notice.body}</p><small>{notice.audience === "all" ? "Toàn hệ thống" : notice.audience === "plan" ? `Gói ${notice.target_plan === "plus" ? "Nâng cao" : "Cơ bản"}` : "Một cửa hàng"} · {notice.platform_notification_recipients?.[0]?.count ?? 0} cửa hàng</small></article>)}</div> : <p className="platform-notice-empty">Chưa có thông báo.</p>}
      {!notices.error && (page > 1 || start + 25 < (notices.count ?? 0)) && <nav className="platform-notice-pagination">{page > 1 && <Link href={`/admin/notifications?page=${page - 1}`}>← Trang trước</Link>}<span>Trang {page}</span>{start + 25 < (notices.count ?? 0) && <Link href={`/admin/notifications?page=${page + 1}`}>Trang sau →</Link>}</nav>}
    </section>
  </main>;
}
