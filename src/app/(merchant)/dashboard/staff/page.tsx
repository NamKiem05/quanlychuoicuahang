import Link from "next/link";
import { redirect } from "next/navigation";
import { getMerchantContext } from "../data";
import { CancelInvite, InviteStaff, RemoveStaff, ResendInvite } from "./staff-forms";
import "./staff.css";

type Member = { user_id: string; role: string; joined_at: string; email: string | null; display_name: string | null };
type Invitation = { id: string; email: string; created_at: string; expires_at: string };
export default async function StoreStaffPage({ searchParams }: { searchParams: Promise<{ message?: string; q?: string }> }) {
  const [{ supabase, store, membership, userId }, query] = await Promise.all([getMerchantContext(), searchParams]);
  if (!store) redirect("/dashboard");
  if (membership?.role !== "owner") return <main className="admin-content store-staff-page"><h1>Quản lý nhân viên</h1><p className="store-staff-error">Chỉ chủ cửa hàng được quản lý nhân viên.</p></main>;
  const members: Member[] = [], invitations: Invitation[] = [];
  let loadError = false;
  for (let offset = 0; ; offset += 1000) {
    const result = await supabase.rpc("owner_store_staff_list", { target_store: store.id }).range(offset, offset + 999);
    if (result.error) { loadError = true; break; }
    members.push(...result.data as Member[]);
    if (result.data.length < 1000) break;
  }
  for (let offset = 0; ; offset += 1000) {
    const result = await supabase.from("store_staff_invitations").select("id, email, created_at, expires_at").eq("store_id", store.id).eq("status", "pending").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).order("id").range(offset, offset + 999);
    if (result.error) { loadError = true; break; }
    invitations.push(...result.data as Invitation[]);
    if (result.data.length < 1000) break;
  }
  const search = (query.q ?? "").trim().slice(0, 100).toLocaleLowerCase("vi-VN");
  const filtered = members.filter((member) => `${member.display_name ?? ""} ${member.email ?? ""}`.toLocaleLowerCase("vi-VN").includes(search));
  const messages: Record<string, string> = { removed: "Đã gỡ nhân viên khỏi cửa hàng.", cancelled: "Đã hủy lời mời.", failed: "Chưa thực hiện được thao tác. Hãy thử lại." };
  return <main className="admin-content store-staff-page"><header><div className="dashboard-kicker">QUẢN LÝ CỬA HÀNG / NHÂN SỰ</div><h1>Quản lý nhân viên</h1><p>Quản lý thành viên và lời mời của {store.name}.</p></header>
    {query.message && messages[query.message] && <p className={query.message === "failed" ? "store-staff-error" : "store-staff-success"} role="status">{messages[query.message]}</p>}
    {loadError ? <p className="store-staff-error" role="alert">Chưa tải được dữ liệu. Hãy kiểm tra migration 202611180027_store_staff_invitations.sql và quyền truy cập.</p> : <><section className="store-staff-stats"><article><span>Tổng thành viên</span><b>{members.length}</b><small>Bao gồm chủ cửa hàng</small></article><article><span>Nhân viên</span><b>{members.filter((member) => member.role === "staff").length}</b><small>Đã tham gia cửa hàng</small></article><article><span>Lời mời chờ</span><b>{invitations.length}</b><small>Còn hiệu lực</small></article></section>
    <section className="store-staff-card"><div className="store-staff-card-heading"><div><h2>Mời nhân viên</h2><p>Tạo lời mời qua email cho người đã có hoặc sẽ đăng ký tài khoản GrowDesk.</p></div></div><InviteStaff /><p className="store-staff-note">Lời mời có hiệu lực 7 ngày. Nhân viên đăng nhập bằng đúng email đã xác minh rồi mở <Link href="/staff-invitations">Lời mời cửa hàng</Link> để chấp nhận. Cần cấu hình email ứng dụng và địa chỉ website công khai. Vai trò nhân viên hiện dùng quyền chung; chưa có phân quyền chi tiết.</p></section>
    <section className="store-staff-card"><div className="store-staff-card-heading"><div><h2>Thành viên cửa hàng</h2><p>Tài khoản có quyền truy cập cửa hàng này.</p></div><span>{filtered.length} / {members.length}</span></div><form className="store-staff-search" method="get"><label><span className="sr-only">Tìm nhân viên</span><input name="q" type="search" defaultValue={search} maxLength={100} placeholder="Tìm theo tên hoặc email" /></label><button type="submit">Tìm kiếm</button>{search && <Link href="/dashboard/staff">Xóa lọc</Link>}</form><div className="store-staff-list">{filtered.map((member) => { const name = member.display_name || member.email || "Tài khoản"; return <article key={member.user_id}><span className="store-staff-avatar">{name.charAt(0).toLocaleUpperCase("vi-VN")}</span><div><b>{name}</b><small>{member.email ?? "Không có email"} · Tham gia {new Date(member.joined_at).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</small></div><span className="store-staff-role">{member.role === "owner" ? "Chủ cửa hàng" : "Nhân viên"}{member.user_id === userId ? " · Bạn" : ""}</span>{member.role === "staff" && <RemoveStaff userId={member.user_id} name={name} />}</article>; })}{!filtered.length && <p className="store-staff-empty">Không tìm thấy thành viên phù hợp.</p>}</div></section>
    <section className="store-staff-card"><div className="store-staff-card-heading"><div><h2>Lời mời đang chờ</h2><p>Lời mời chưa được chấp nhận và còn hiệu lực.</p></div><span>{invitations.length} lời mời</span></div><div className="store-staff-list">{invitations.map((invite) => <article key={invite.id}><span className="store-staff-avatar">✉</span><div><b>{invite.email}</b><small>Hết hạn {new Date(invite.expires_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</small></div><span className="store-staff-role">Chờ chấp nhận</span><ResendInvite id={invite.id} /><CancelInvite id={invite.id} email={invite.email} /></article>)}{!invitations.length && <p className="store-staff-empty">Không có lời mời đang chờ.</p>}</div></section></>}
  </main>;
}
