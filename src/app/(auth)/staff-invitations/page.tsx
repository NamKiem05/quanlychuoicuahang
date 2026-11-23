import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireMerchantAccount } from "@/lib/platform-account";
import { respondInvitation } from "./actions";
import "./staff-invitations.css";

type Invitation = { id: string; store_name: string; store_slug: string; created_at: string; expires_at: string };
export default async function StaffInvitations({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login?next=staff-invitations");
  await requireMerchantAccount(supabase);
  const query = await searchParams;
  const result = await supabase.rpc("my_store_staff_invitations");
  const rows = (result.data ?? []) as Invitation[];
  return <main className="staff-invitations-page"><section className="staff-invitations-card"><Link href="/dashboard" className="staff-invitations-back">← Về khu vực cửa hàng</Link><small>GROWDESK · TÀI KHOẢN</small><h1>Lời mời cửa hàng</h1><p>Chấp nhận lời mời bằng tài khoản có email trùng với lời mời và đã xác minh.</p>{!data.user.email_confirmed_at && <p className="staff-invitations-alert" role="status">Email của bạn chưa được xác minh. Hãy xác minh email trước khi nhận lời mời.</p>}{query.message === "failed" && <p className="staff-invitations-alert" role="alert">Lời mời không còn hiệu lực hoặc bạn không có quyền chấp nhận. Hãy tải lại trang.</p>}{query.message === "declined" && <p className="staff-invitations-success" role="status">Đã từ chối lời mời.</p>}{result.error ? <p className="staff-invitations-alert" role="alert">Không tải được lời mời. Hãy kiểm tra migration 202611180027_store_staff_invitations.sql.</p> : rows.length ? <div className="staff-invitations-list">{rows.map((invite) => <article key={invite.id}><div><h2>{invite.store_name}</h2><p>/{invite.store_slug} · Vai trò nhân viên</p><small>Hết hạn {new Date(invite.expires_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</small></div><form action={respondInvitation}><input type="hidden" name="invitation_id" value={invite.id} /><button type="submit" name="decision" value="accept">Chấp nhận</button><button type="submit" name="decision" value="decline" className="staff-invitations-decline">Từ chối</button></form></article>)}</div> : <p className="staff-invitations-empty">Không có lời mời còn hiệu lực cho email này.</p>}</section></main>;
}
