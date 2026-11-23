import type { Metadata } from "next";
import { connection } from "next/server";
import Toast from "@/components/ui/toast";
import { toastVariantForMessage } from "@/lib/toast";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import RevokeAdminForm from "./revoke-admin-form";
import { InviteAdminForm, InvitationActions } from "./invitation-forms";
import Link from "next/link";
import type { AuthUser } from "@supabase/supabase-js";
import { staffRoleLabels } from "@/lib/platform-staff-role";
import "./admin-staff.css";

export const metadata: Metadata = { title: "Quản trị viên | Quản trị nền tảng" };

const messages: Record<string, string> = {
  "admin-invalid-email": "Nhập một địa chỉ email hợp lệ.",
  "admin-list-failed": "Chưa tra cứu được người dùng trong Supabase Auth.",
  "admin-separation-required": "Cần cập nhật cơ sở dữ liệu trước khi cấp quyền cho tài khoản quản trị riêng.",
  "admin-user-not-found": "Chưa tìm thấy tài khoản quản trị theo email đã nhập.",
  "admin-merchant-account-invalid": "Email này đang dùng cho tài khoản cửa hàng. Hãy dùng email riêng để tạo tài khoản admin.",
  "admin-grant-failed": "Chưa cấp được quyền quản trị. Hãy thử lại.",
  "admin-already-admin": "Tài khoản này đã có quyền quản trị nền tảng.",
  "admin-granted": "Đã cấp quyền quản trị nền tảng.",
  "admin-invalid-target": "Tài khoản quản trị được chọn không hợp lệ.",
  "admin-self-protected": "Bạn không thể tự thu hồi quyền quản trị của chính mình.",
  "admin-last-protected": "Không thể thu hồi quyền của quản trị viên cuối cùng.",
  "admin-not-found": "Tài khoản này không còn trong danh sách quản trị viên.",
  "admin-revoke-failed": "Chưa thu hồi được quyền quản trị. Hãy thử lại.",
  "admin-revoked": "Đã thu hồi quyền truy cập khu vực quản trị.",
};

type Profile = { id: string; display_name: string; phone: string | null };
function isSuspended(value: string | null | undefined) { return Boolean(value && Date.parse(value) > Date.now()); }

export default async function AdminManagementPage({ searchParams }: PageProps<"/admin/admins">) {
  await connection();
  const sessionClient = await createClient();
  await requirePlatformAdminAccess(sessionClient);
  const query = await searchParams;
  const messageKey = typeof query.message === "string" ? query.message : "";
  const message = messages[messageKey];
  const search = typeof query.q === "string" ? query.q.trim().slice(0, 100).toLocaleLowerCase("vi-VN") : "";
  const status = query.status === "active" || query.status === "suspended" || query.status === "pending" ? query.status : "";
  let adminClient: ReturnType<typeof createAdminClient>;
  try {
    adminClient = createAdminClient();
  } catch {
    return <div className="admin-content"><h1 className="admin-page-title">Quản trị viên</h1><p className="admin-error" role="alert">Chưa cấu hình quyền truy cập quản trị Supabase ở phía máy chủ.</p></div>;
  }

  const { data: adminRows, error } = await adminClient
    .from("platform_admins")
    .select("user_id, created_at")
    .order("created_at", { ascending: true });
  const adminRoles = new Map((adminRows ?? []).map((row) => [row.user_id as string, row.created_at as string]));
  const scopedResult = await adminClient.from("platform_staff_roles").select("user_id, role_code, granted_at");
  const invitations = await sessionClient.from("platform_staff_invitations").select("id, email, status, created_at, expires_at, staff_role_label").order("created_at", { ascending: false }).limit(50);
  const scopedRoles = new Map((scopedResult.data ?? []).map((row) => [row.user_id as string, { code: row.role_code as string, grantedAt: row.granted_at as string }]));
  const staff: AuthUser[] = [];
  let usersUnavailable = false;
  let authPage = 1;
  for (;;) {
    const result = await adminClient.auth.admin.listUsers({ page: authPage, perPage: 1000 });
    if (result.error) { usersUnavailable = true; break; }
    staff.push(...result.data.users.filter((user) => user.app_metadata?.account_kind === "platform_admin" || adminRoles.has(user.id)));
    if (!result.data.nextPage || result.data.nextPage <= authPage) break;
    authPage = result.data.nextPage;
  }
  const userIds = staff.map((user) => user.id);
  const profilesById = new Map<string, Profile>();
  for (let offset = 0; offset < userIds.length; offset += 250) {
    const { data: profiles, error: profileError } = await adminClient.from("profiles").select("id, display_name, phone").in("id", userIds.slice(offset, offset + 250));
    if (profileError) usersUnavailable = true;
    for (const profile of (profiles ?? []) as Profile[]) profilesById.set(profile.id, profile);
  }
  const filteredRows = staff.filter((user) => {
    const profile = profilesById.get(user.id);
    const matchesSearch = [profile?.display_name, user.email, user.phone, user.id].filter(Boolean).join(" ").toLocaleLowerCase("vi-VN").includes(search);
    const hasPermission = adminRoles.has(user.id) || scopedRoles.has(user.id);
    const matchesStatus = !status || (status === "pending" ? !hasPermission && !scopedResult.error : status === "suspended" ? isSuspended(user.banned_until) : hasPermission && !isSuspended(user.banned_until));
    return matchesSearch && matchesStatus;
  });
  const statsAvailable = !error && !usersUnavailable && !scopedResult.error;
  const permissionCount = staff.filter((user) => adminRoles.has(user.id) || scopedRoles.has(user.id)).length;
  const lockedCount = staff.filter((user) => isSuspended(user.banned_until)).length;

  return (
    <div className="admin-content admin-accounts-page admin-staff-page">
      <div className="admin-staff-page-header">
        <div><div className="dashboard-kicker">QUẢN LÝ NỀN TẢNG / NHÂN SỰ</div><h1 className="admin-page-title">Quản lý nhân viên</h1><p className="dashboard-intro">Theo dõi thành viên, vai trò và quyền truy cập trong một nơi.</p></div>
        <a className="staff-invite-button" href="#invite-admin">+ Mời nhân viên</a>
      </div>
      <Toast message={message} variant={toastVariantForMessage(messageKey)} />
      {error && <p className="admin-error" role="alert">Không tải được danh sách quyền quản trị. Kiểm tra cấu hình Supabase.</p>}
      {usersUnavailable && <p className="admin-error" role="alert">Một số tài khoản không tải được thông tin đăng nhập hoặc trạng thái; kết quả lọc có thể chưa đầy đủ.</p>}
      {scopedResult.error && <p className="admin-error" role="alert">Chưa tải được quyền hỗ trợ giới hạn. Kiểm tra migration 202611180016_support_role_permissions.sql.</p>}
      <section className="admin-staff-stats" aria-label="Thống kê nhân viên">
        <div><span className="admin-staff-stat-icon" aria-hidden="true">♙</span><p>Tổng nhân viên<strong>{statsAvailable ? staff.length : "—"}</strong><small>Tài khoản nhân sự</small></p></div>
        <div><span className="admin-staff-stat-icon is-blue" aria-hidden="true">✓</span><p>Đã cấp quyền<strong>{statsAvailable ? permissionCount : "—"}</strong><small>Có quyền truy cập</small></p></div>
        <div><span className="admin-staff-stat-icon is-gold" aria-hidden="true">◷</span><p>Chưa cấp quyền<strong>{statsAvailable ? staff.length - permissionCount : "—"}</strong><small>Cần phân quyền</small></p></div>
        <div><span className="admin-staff-stat-icon is-red" aria-hidden="true">⊘</span><p>Đã khóa<strong>{statsAvailable ? lockedCount : "—"}</strong><small>Tài khoản bị khóa</small></p></div>
      </section>
      <div className="admin-staff-note"><strong>Vai trò và quyền truy cập</strong><p>Nhân viên tự chấp nhận lời mời qua email và đặt mật khẩu. Sau đó, quản trị viên cấp quyền tại mục <Link href="/admin/roles">Vai trò và phân quyền</Link>.</p></div>

      <section id="invite-admin" className="admin-staff-panel staff-invitations">
        <h2>Mời nhân viên qua email</h2><p>Chọn vai trò và nhập email riêng của nhân viên. Lời mời có hiệu lực trong 7 ngày; quyền truy cập được cấp riêng.</p>
        <InviteAdminForm />
        {invitations.error ? <p role="alert">Chưa tải được lời mời. Hãy chạy các migration 202611180030 và 202611180031.</p> : <div className="staff-invitation-list"><h3>Lời mời gần đây</h3>{(invitations.data ?? []).length === 0 ? <p>Chưa có lời mời nào.</p> : (invitations.data ?? []).map((invitation) => {
          const expired = invitation.status === "pending" && Date.parse(invitation.expires_at) <= Date.now();
          const label = expired ? "Đã hết hạn" : ({ pending: "Chờ chấp nhận", processing: "Đang xử lý — cần kiểm tra", accepted: "Đã chấp nhận", revoked: "Đã hủy" } as Record<string, string>)[invitation.status] ?? invitation.status;
          return <div className="staff-invitation-row" key={invitation.id}><div><strong>{invitation.email}</strong><small>{label} · {staffRoleLabels[invitation.staff_role_label] ?? "Chưa chọn vai trò"} · Hết hạn {new Date(invitation.expires_at).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</small></div>{invitation.status === "pending" && <InvitationActions id={invitation.id} expired={expired} />}</div>;
        })}</div>}
      </section>
      <section className="admin-store-list admin-admin-management-card">
        <div className="admin-list-heading"><div><h2>Danh sách nhân viên</h2><p>Tài khoản nhân viên được quản lý riêng với tài khoản cửa hàng.</p></div><span>{filteredRows.length} / {staff.length} nhân viên</span></div>
        <form className="admin-staff-filters" method="get"><label>Tìm theo tên, email hoặc mã<input type="search" name="q" maxLength={100} defaultValue={search} placeholder="Tên hoặc email nhân viên..." /></label><label>Trạng thái<select name="status" defaultValue={status}><option value="">Tất cả trạng thái</option><option value="pending">Chưa cấp quyền</option><option value="active">Đã cấp quyền</option><option value="suspended">Đã khóa</option></select></label><button className="secondary-submit" type="submit">Lọc</button>{(search || status) && <Link href="/admin/admins">Xóa lọc</Link>}</form>
        {error ? null : filteredRows.length ? filteredRows.map((user) => {
          const profile = profilesById.get(user.id);
          const email = user.email || user.phone || "Tài khoản không có email";
          const name = profile?.display_name || user.user_metadata?.display_name || user.user_metadata?.full_name || user.user_metadata?.name || email;
          const hasFullAccess = adminRoles.has(user.id);
          const scoped = scopedRoles.get(user.id);
          const selectedRole = staffRoleLabels[String(user.app_metadata?.staff_role_label ?? "")];
          const grantedAt = adminRoles.get(user.id) ?? scoped?.grantedAt;
          return (
            <article className="admin-store-row admin-admin-account-row" key={user.id}>
              <span className="admin-staff-list-avatar" aria-hidden="true">{String(name).trim().charAt(0).toLocaleUpperCase("vi-VN") || "?"}</span><div className="admin-store-main">
              <div className="admin-store-title"><Link href={`/admin/admins/${user.id}`}><b>{name}</b></Link><span className="account-role-badge account-role-admin">{hasFullAccess ? "Admin toàn nền tảng" : scoped?.code === "support_admin" ? "Hỗ trợ ticket" : scopedResult.error ? "Quyền chưa xác định" : "Chưa cấp quyền"}</span><span className={`status-badge ${isSuspended(user.banned_until) ? "status-suspended" : "status-active"}`}>{isSuspended(user.banned_until) ? "Đã khóa" : "Tài khoản chưa bị khóa"}</span></div>
                <span className="admin-store-slug">{email}{selectedRole ? ` · Vai trò: ${selectedRole}` : ""}</span>
                <div className="admin-store-meta"><span>{profile?.phone || user.phone || "Chưa có số điện thoại"}</span><span>{grantedAt ? `Cấp quyền ngày ${new Date(grantedAt).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}` : "Chưa được cấp quyền quản trị"}</span>{!user.email_confirmed_at && <span>Email chưa xác minh</span>}</div>
              </div>
              <div className="admin-staff-row-actions"><Link href={`/admin/admins/${user.id}`}>Xem chi tiết →</Link>{hasFullAccess && <RevokeAdminForm userId={user.id} email={email} />}</div>
            </article>
          );
        }) : <div className="admin-empty"><span>♜</span><b>{staff.length ? "Không tìm thấy nhân viên phù hợp" : "Chưa có nhân viên"}</b><p>{staff.length ? "Hãy thay đổi bộ lọc và thử lại." : "Gửi lời mời để thêm nhân viên."}</p></div>}
      </section>

      <p className="admin-admin-management-note">Để tránh khóa mình khỏi hệ thống, bạn không thể tự thu hồi quyền của chính mình hoặc thu hồi quyền của quản trị viên cuối cùng.</p>
    </div>
  );
}
