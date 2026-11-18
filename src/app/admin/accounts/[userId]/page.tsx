import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import AccountStatusForm from "../account-status-form";
import { updateAccountProfile } from "../actions";
import "../account-detail.css";

const formatDate = new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
function date(value: string | null | undefined) { return value ? formatDate.format(new Date(value)) : "Chưa có dữ liệu"; }
function suspended(value: string | null | undefined) { return Boolean(value && Date.parse(value) > Date.now()); }

export default async function AccountDetail({ params, searchParams }: { params: Promise<{ userId: string }>; searchParams: Promise<{ message?: string }> }) {
  await connection();
  const [{ userId }, query] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) notFound();
  await requirePlatformAdminAccess(await createClient());
  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch { return <main className="admin-content"><p className="admin-error">Chưa cấu hình quyền quản trị Supabase.</p></main>; }
  const [adminRole, userResult, profileResult, storesResult] = await Promise.all([
    admin.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
    admin.auth.admin.getUserById(userId),
    admin.from("profiles").select("display_name, phone").eq("id", userId).maybeSingle(),
    admin.from("store_members").select("role, stores(id, name, slug)").eq("user_id", userId).eq("role", "owner").overrideTypes<Array<{ role: string; stores: { id: string; name: string; slug: string } | null }>, { merge: false }>(),
  ]);
  if (adminRole.error) return <main className="admin-content"><p className="admin-error">Không xác minh được loại tài khoản.</p></main>;
  if (adminRole.data) notFound();
  if (userResult.error || !userResult.data.user) return <main className="admin-content"><p className="admin-error">Không tải được tài khoản.</p><Link href="/admin/accounts">← Danh sách tài khoản</Link></main>;
  const user = userResult.data.user;
  const locked = suspended(user.banned_until);
  const profile = profileResult.data;
  const name = profile?.display_name || String(user.user_metadata?.display_name ?? "") || user.email || "Tài khoản";
  const notices: Record<string, string> = { created: "Đã tạo tài khoản. Email chưa được xác minh và chưa có email xác minh tự động.", updated: "Đã cập nhật thông tin.", invalid: "Thông tin chưa hợp lệ.", failed: "Chưa cập nhật được thông tin." };
  return <main className="admin-content account-detail"><Link className="account-detail-back" href="/admin/accounts">← Danh sách tài khoản</Link>
    {query.message && <p className={query.message === "created" || query.message === "updated" ? "account-detail-notice" : "admin-error"} role="status">{notices[query.message]}</p>}
    <header className="account-detail-hero"><div className="account-detail-avatar">{name.charAt(0).toLocaleUpperCase("vi-VN")}</div><div><span>HỒ SƠ TÀI KHOẢN</span><h1>{name}</h1><p>{user.email || "Chưa có email"}</p></div><span className={`status-badge ${locked ? "status-suspended" : "status-active"}`}>{locked ? "Đã khóa" : "Hoạt động"}</span><AccountStatusForm userId={user.id} suspended={locked} search="" status="" page={1} /></header>
    <div className="account-detail-grid">
      <section className="account-detail-card"><h2>Thông tin tài khoản</h2><p>Chỉnh sửa hồ sơ liên hệ trên nền tảng.</p>
        {profileResult.error ? <p className="admin-error">Không tải được hồ sơ.</p> : <form className="dashboard-form account-detail-form" action={updateAccountProfile}><input type="hidden" name="user_id" value={user.id} /><label>Họ và tên<input name="name" defaultValue={profile?.display_name ?? ""} required minLength={2} maxLength={120} /></label><label>Số điện thoại liên hệ<input name="phone" type="tel" defaultValue={profile?.phone ?? ""} maxLength={30} /></label><button className="secondary-submit" type="submit">Lưu thông tin</button></form>}
        <dl className="account-detail-fields"><div><dt>Mã tài khoản</dt><dd>{user.id}</dd></div><div><dt>Ngày tạo</dt><dd>{date(user.created_at)}</dd></div></dl>
      </section>
      <div className="account-detail-side">
        <section className="account-detail-card"><h2>Xác minh liên hệ</h2><p>Trạng thái do Supabase Auth ghi nhận.</p><dl className="account-detail-fields"><div><dt>Email</dt><dd>{user.email || "Chưa có"} · {user.email_confirmed_at ? "Đã xác minh" : "Chưa xác minh"}</dd></div><div><dt>Số điện thoại Auth</dt><dd>{user.phone || "Chưa đăng ký"} · {user.phone_confirmed_at ? "Đã xác minh" : "Chưa xác minh"}</dd></div></dl><p>Số điện thoại liên hệ trong hồ sơ không đồng nghĩa với số điện thoại đã xác minh.</p></section>
        <section className="account-detail-card"><h2>Cửa hàng sở hữu</h2>{storesResult.error ? <p>Không tải được danh sách cửa hàng.</p> : storesResult.data?.length ? <ul className="account-detail-stores">{storesResult.data.map((member) => member.stores && <li key={member.stores.id}><Link href={`/admin/stores/${member.stores.id}`}>{member.stores.name}</Link><small>/{member.stores.slug}</small></li>)}</ul> : <p>Chưa sở hữu cửa hàng.</p>}</section>
        <section className="account-detail-card"><h2>Đăng nhập</h2><dl className="account-detail-fields"><div><dt>Lần gần nhất</dt><dd>{date(user.last_sign_in_at)}</dd></div></dl><p>Hệ thống hiện chưa lưu lịch sử từng lần đăng nhập.</p></section>
      </div>
    </div>
  </main>;
}
