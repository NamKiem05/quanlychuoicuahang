import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { staffRoleLabels } from "@/lib/platform-staff-role";
import { updatePlatformAdminProfile } from "../actions";
import RevokeAdminForm from "../revoke-admin-form";
import "../admin-staff.css";

const dateFormat = new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
function date(value: string | null | undefined) { return value ? dateFormat.format(new Date(value)) : "Chưa có dữ liệu"; }
function isSuspended(value: string | null | undefined) { return Boolean(value && Date.parse(value) > Date.now()); }

export default async function AdminStaffDetail({ params, searchParams }: { params: Promise<{ userId: string }>; searchParams: Promise<{ message?: string }> }) {
  await connection();
  const [{ userId }, query, supabase] = await Promise.all([params, searchParams, createClient()]);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) notFound();
  const actor = await requirePlatformAdminAccess(supabase);
  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch { return <main className="admin-content"><p className="admin-error">Chưa cấu hình quyền quản trị Supabase.</p></main>; }
  const [role, userResult, profile, scopedRole] = await Promise.all([
    admin.from("platform_admins").select("user_id, created_at").eq("user_id", userId).maybeSingle(),
    admin.auth.admin.getUserById(userId),
    admin.from("profiles").select("display_name, phone").eq("id", userId).maybeSingle(),
    admin.from("platform_staff_roles").select("role_code, granted_at").eq("user_id", userId).maybeSingle(),
  ]);
  if (role.error) return <main className="admin-content"><p className="admin-error">Không kiểm tra được quyền nhân viên.</p><Link href="/admin/admins">← Danh sách nhân viên</Link></main>;
  if (userResult.error || !userResult.data.user) return <main className="admin-content"><p className="admin-error">Không tải được tài khoản nhân viên.</p><Link href="/admin/admins">← Danh sách nhân viên</Link></main>;
  const user = userResult.data.user;
  const selectedRole = staffRoleLabels[String(user.app_metadata?.staff_role_label ?? "")];
  if (!role.data && user.app_metadata?.account_kind !== "platform_admin") notFound();
  const name = profile.data?.display_name || user.user_metadata?.display_name || user.email || "Quản trị viên";
  const locked = isSuspended(user.banned_until);
  const messages: Record<string, string> = { updated: "Đã cập nhật hồ sơ nhân viên.", invalid: "Thông tin chưa hợp lệ.", failed: "Không cập nhật được hồ sơ. Hãy kiểm tra quyền và thử lại." };
  return <main className="admin-content admin-staff-detail"><Link href="/admin/admins" className="admin-staff-back">← Danh sách nhân viên</Link>
    {query.message && messages[query.message] && <p className={query.message === "updated" ? "admin-staff-success" : "admin-error"} role="status">{messages[query.message]}</p>}
    <header className="admin-staff-hero"><span className="admin-staff-avatar" aria-hidden="true">{String(name).charAt(0).toLocaleUpperCase("vi-VN")}</span><div><small>HỒ SƠ NHÂN VIÊN</small><h1>{name}</h1><p>{user.email ?? "Chưa có email"}{selectedRole ? ` · Vai trò: ${selectedRole}` : ""}</p></div><span className={`status-badge ${locked ? "status-suspended" : "status-active"}`}>{locked ? "Đã khóa" : "Tài khoản chưa bị khóa"}</span>{role.data && actor !== userId && <RevokeAdminForm userId={user.id} email={user.email ?? "nhân viên này"} />}</header>
    <div className="admin-staff-grid"><section className="admin-staff-panel"><h2>Thông tin nhân viên</h2><p>Thông tin liên hệ dùng trong hệ thống.</p>{profile.error ? <p className="admin-error">Không tải được hồ sơ.</p> : <form className="admin-staff-form" action={updatePlatformAdminProfile}><input type="hidden" name="user_id" value={user.id} /><label>Họ và tên<input name="name" required minLength={2} maxLength={120} defaultValue={profile.data?.display_name || String(user.user_metadata?.display_name ?? "")} /></label><label>Số điện thoại liên hệ<input name="phone" type="tel" maxLength={30} defaultValue={profile.data?.phone ?? ""} /></label><button className="approve-button" type="submit">Lưu thay đổi</button></form>}<dl className="admin-staff-fields"><div><dt>Mã tài khoản</dt><dd>{user.id}</dd></div><div><dt>Ngày tạo tài khoản</dt><dd>{date(user.created_at)}</dd></div><div><dt>Ngày cấp quyền</dt><dd>{date(role.data?.created_at ?? scopedRole.data?.granted_at)}</dd></div></dl></section>
      <div className="admin-staff-side"><section className="admin-staff-panel"><h2>Vai trò & quyền</h2><div className="admin-staff-role">{role.data ? "Quản trị viên nền tảng" : scopedRole.data?.role_code === "support_admin" ? "Nhân viên hỗ trợ" : scopedRole.error ? "Chưa xác định quyền" : "Chưa được cấp quyền"}<span>{role.data ? "Toàn quyền" : scopedRole.data?.role_code === "support_admin" ? "Ticket" : "Không có quyền admin"}</span></div><p>{role.data ? "Tài khoản có quyền quản trị toàn nền tảng." : scopedRole.data?.role_code === "support_admin" ? "Tài khoản chỉ được truy cập và xử lý ticket hỗ trợ." : scopedRole.error ? "Không tải được quyền giới hạn; kiểm tra migration." : "Tài khoản chưa truy cập được khu vực quản trị."}</p><Link href="/admin/roles">Đến vai trò và phân quyền →</Link></section><section className="admin-staff-panel"><h2>Trạng thái đăng nhập</h2><dl className="admin-staff-fields"><div><dt>Trạng thái tài khoản</dt><dd>{locked ? "Đã khóa" : "Chưa bị khóa"}</dd></div><div><dt>Đăng nhập gần nhất</dt><dd>{date(user.last_sign_in_at)}</dd></div><div><dt>Email</dt><dd>{user.email_confirmed_at ? "Đã xác minh" : "Chưa xác minh"}</dd></div></dl><p>Chưa có lịch sử đầy đủ các phiên đăng nhập. Việc khóa và mở khóa nhân viên chưa được hỗ trợ tại đây.</p></section></div>
    </div>
  </main>;
}
