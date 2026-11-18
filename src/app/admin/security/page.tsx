import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import "./security.css";

export const metadata = { title: "Bảo mật | Quản trị" };
const dateFormat = new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
const fields: Record<string, string> = { name: "tên", slug: "đường dẫn", phone: "số điện thoại", address: "địa chỉ", description: "giới thiệu", status: "trạng thái" };
const statuses: Record<string, string> = { draft: "Chờ duyệt", active: "Hoạt động", paused: "Tạm dừng", suspended: "Đã khóa" };
export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const [supabase, query] = await Promise.all([createClient(), searchParams]);
  await requirePlatformAdminAccess(supabase);
  const page = typeof query.page === "string" && /^[1-9]\d{0,5}$/.test(query.page) ? Number(query.page) : 1;
  const start = (page - 1) * 25;
  const result = await supabase.from("admin_store_security_audit").select("id, actor_id, store_id, store_name, action, changed_fields, old_status, new_status, occurred_at", { count: "exact" }).order("occurred_at", { ascending: false }).order("id").range(start, start + 24);
  return <main className="admin-content security-page"><header className="security-heading"><span aria-hidden="true">◇</span><div><div className="dashboard-kicker">HỆ THỐNG</div><h1 className="admin-page-title">Quản lý bảo mật</h1><p>Theo dõi các hoạt động quản trị đã được tích hợp.</p></div></header>
    <div className="security-note"><strong>Phạm vi nhật ký hiện tại</strong><p>Chỉ ghi thay đổi tên, đường dẫn, liên hệ, giới thiệu, trạng thái và xóa cửa hàng được thực hiện bằng phiên admin sau khi cài migration. Các hành động qua service role hoặc thay đổi khác chưa được ghi vào trang này.</p></div>
    <section className="security-panel"><header><div><h2>Nhật ký cửa hàng</h2><p>{result.error ? "Không tải được dữ liệu" : `${(result.count ?? 0).toLocaleString("vi-VN")} sự kiện`}</p></div></header>
      {result.error ? <p className="security-empty" role="alert">Chưa tải được nhật ký. Cần chạy migration 202611180013_admin_store_security_audit.sql.</p> : result.data?.length ? <div className="security-table-wrap"><table><thead><tr><th>Thời gian</th><th>Admin</th><th>Cửa hàng</th><th>Hoạt động</th></tr></thead><tbody>{result.data.map((event) => <tr key={event.id}><td>{dateFormat.format(new Date(event.occurred_at))}</td><td><code>{event.actor_id ?? "Tài khoản đã xóa"}</code></td><td>{event.action === "deleted" ? event.store_name : <Link href={`/admin/stores/${event.store_id}`}>{event.store_name}</Link>}</td><td><b>{event.action === "deleted" ? "Xóa cửa hàng" : "Cập nhật cửa hàng"}</b>{event.changed_fields?.length > 0 && <small>Trường: {event.changed_fields.map((field: string) => fields[field] ?? field).join(", ")}</small>}{event.old_status && event.new_status && <small>{statuses[event.old_status] ?? event.old_status} → {statuses[event.new_status] ?? event.new_status}</small>}</td></tr>)}</tbody></table></div> : <p className="security-empty">Chưa có sự kiện trong phạm vi được ghi nhận.</p>}
      {!result.error && (page > 1 || start + 25 < (result.count ?? 0)) && <nav className="security-pagination" aria-label="Phân trang nhật ký">{page > 1 && <Link href={`/admin/security?page=${page - 1}`}>← Trang trước</Link>}<span>Trang {page}</span>{start + 25 < (result.count ?? 0) && <Link href={`/admin/security?page=${page + 1}`}>Trang sau →</Link>}</nav>}
    </section>
    <section className="security-panel security-features"><header><div><h2>Các tính năng cần tích hợp thêm</h2><p>Trạng thái này không xác nhận cấu hình hiện tại trên Supabase.</p></div></header><div className="security-feature-grid">{["Nhật ký & IP đăng nhập", "Phát hiện đăng nhập bất thường", "Quản lý & thu hồi phiên", "Xác thực hai yếu tố (2FA)", "Giới hạn đăng nhập sai", "Quản lý API Key & quyền API", "Theo dõi yêu cầu đáng ngờ"].map((label) => <div key={label}><span>{label}</span><b>Chưa tích hợp</b></div>)}</div></section>
    <section className="security-resources"><h2>Quản trị Supabase Auth</h2><p>Nhật ký xác thực và các giới hạn Auth được cấu hình tại Supabase; trang này chưa đọc trạng thái của chúng.</p><div><a href="https://supabase.com/docs/guides/auth/audit-logs" target="_blank" rel="noreferrer">Nhật ký Auth ↗</a><a href="https://supabase.com/docs/guides/auth/auth-mfa" target="_blank" rel="noreferrer">Hướng dẫn MFA ↗</a><a href="https://supabase.com/docs/guides/auth/rate-limits" target="_blank" rel="noreferrer">Giới hạn Auth ↗</a></div></section>
  </main>;
}
