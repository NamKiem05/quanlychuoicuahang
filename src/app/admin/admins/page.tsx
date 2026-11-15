import type { Metadata } from "next";
import { connection } from "next/server";
import Toast from "@/app/toast";
import { toastVariantForMessage } from "@/lib/toast";
import { createAdminClient } from "@/lib/supabase/admin";
import GrantAdminForm from "./grant-admin-form";
import RevokeAdminForm from "./revoke-admin-form";

export const metadata: Metadata = { title: "Quản trị viên | Quản trị nền tảng" };

const messages: Record<string, string> = {
  "admin-invalid-email": "Nhập một địa chỉ email hợp lệ.",
  "admin-list-failed": "Chưa tra cứu được người dùng trong Supabase Auth.",
  "admin-user-not-found": "Không tìm thấy tài khoản đã đăng ký bằng email này.",
  "admin-grant-failed": "Chưa cấp được quyền quản trị. Hãy thử lại.",
  "admin-already-admin": "Tài khoản này đã có quyền quản trị nền tảng.",
  "admin-granted": "Đã cấp quyền quản trị nền tảng.",
  "admin-invalid-target": "Tài khoản quản trị được chọn không hợp lệ.",
  "admin-self-protected": "Bạn không thể tự thu hồi quyền quản trị của chính mình.",
  "admin-last-protected": "Không thể thu hồi quyền của quản trị viên cuối cùng.",
  "admin-not-found": "Tài khoản này không còn trong danh sách quản trị viên.",
  "admin-revoke-failed": "Chưa thu hồi được quyền quản trị. Hãy thử lại.",
  "admin-revoked": "Đã thu hồi quyền quản trị. Tài khoản đã chuyển về danh sách tài khoản thường.",
};

type Profile = { id: string; display_name: string; phone: string | null };

export default async function AdminManagementPage({ searchParams }: PageProps<"/admin/admins">) {
  await connection();
  const query = await searchParams;
  const messageKey = typeof query.message === "string" ? query.message : "";
  const message = messages[messageKey];
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
  const rows = adminRows ?? [];
  const usersResult = await Promise.all(rows.map((row) => adminClient.auth.admin.getUserById(row.user_id)));
  const usersById = new Map(usersResult.flatMap((result) => result.error || !result.data.user ? [] : [[result.data.user.id, result.data.user] as const]));
  const userIds = [...usersById.keys()];
  let profilesById = new Map<string, Profile>();
  if (userIds.length) {
    const { data: profiles } = await adminClient.from("profiles").select("id, display_name, phone").in("id", userIds);
    profilesById = new Map(((profiles ?? []) as Profile[]).map((profile) => [profile.id, profile]));
  }

  return (
    <div className="admin-content admin-accounts-page">
      <div className="dashboard-kicker">QUẢN LÝ NỀN TẢNG</div>
      <h1 className="admin-page-title">Quản trị viên</h1>
      <p className="dashboard-intro">Quản lý riêng những tài khoản có quyền điều hành toàn nền tảng.</p>
      <Toast message={message} variant={toastVariantForMessage(messageKey)} />
      {error && <p className="admin-error" role="alert">Không tải được danh sách quyền quản trị. Kiểm tra cấu hình Supabase.</p>}

      <section className="admin-store-list admin-admin-management-card">
        <div className="admin-list-heading"><div><h2>Cấp quyền admin cho tài khoản hiện có</h2><p>Chỉ nhập email của người đã đăng ký tài khoản trên website.</p></div></div>
        <GrantAdminForm />
      </section>

      <section className="admin-store-list admin-admin-management-card">
        <div className="admin-list-heading"><div><h2>Danh sách quản trị viên</h2><p>Tài khoản ở đây được ẩn khỏi danh sách tài khoản thường.</p></div><span>{rows.length} quản trị viên</span></div>
        {error ? null : rows.length ? rows.map((row) => {
          const user = usersById.get(row.user_id);
          const profile = profilesById.get(row.user_id);
          const email = user?.email || user?.phone || "Tài khoản không có email";
          const name = profile?.display_name || user?.user_metadata?.full_name || user?.user_metadata?.name || email;
          return (
            <article className="admin-store-row admin-admin-account-row" key={row.user_id}>
              <div className="admin-store-main">
                <div className="admin-store-title"><b>{name}</b><span className="account-role-badge account-role-admin">Quản trị viên</span></div>
                <span className="admin-store-slug">{email}</span>
                <div className="admin-store-meta"><span>{profile?.phone || user?.phone || "Chưa có số điện thoại"}</span><span>Cấp quyền ngày {new Date(row.created_at).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</span></div>
              </div>
              {user && <RevokeAdminForm userId={row.user_id} email={email} />}
            </article>
          );
        }) : <div className="admin-empty"><span>♜</span><b>Chưa có quản trị viên</b><p>Cấp quyền admin cho một tài khoản đã đăng ký bằng biểu mẫu phía trên.</p></div>}
      </section>

      <p className="admin-admin-management-note">Để tránh khóa mình khỏi hệ thống, bạn không thể tự thu hồi quyền của chính mình hoặc thu hồi quyền của quản trị viên cuối cùng.</p>
    </div>
  );
}
