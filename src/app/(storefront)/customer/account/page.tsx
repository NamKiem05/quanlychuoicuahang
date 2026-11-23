import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import SidebarIcon from "@/components/ui/sidebar-icon";
import ProfileForm from "./profile-form";
import { createClient } from "@/lib/supabase/server";
import "./account.css";

export const metadata = { title: "Tài khoản của tôi | GrowDesk" };
export const instant = false;

export default async function CustomerAccount() {
  await connection();
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect("/login?next=customer-account");
  const { data: profile, error: profileError } = await supabase.from("profiles").select("display_name, phone, created_at").eq("id", user.id).maybeSingle();

  return <section className="customer-account-main"><div className="customer-account-heading"><span>TÀI KHOẢN MUA HÀNG</span><h1>Thông tin tài khoản</h1><p>Quản lý thông tin bạn sử dụng khi mua hàng.</p></div><section className="customer-account-card"><div className="customer-account-card-header"><div><h2>Hồ sơ cá nhân</h2><p>Thông tin đã đăng ký với GrowDesk</p></div><span className={user.email_confirmed_at ? "verified" : "unverified"}>{user.email_confirmed_at ? "Email đã xác minh" : "Email chưa xác minh"}</span></div>{profileError && <p className="customer-account-error" role="alert">Chưa tải được đầy đủ hồ sơ. Hãy thử lại sau.</p>}<ProfileForm name={profile?.display_name || ""} phone={profile?.phone || ""} email={user.email || ""} /></section><Link className="customer-account-orders" href="/customer/orders"><span><SidebarIcon name="orders" /><span><b>Đơn hàng của tôi</b><small>Xem lịch sử và trạng thái đơn hàng</small></span></span><strong>→</strong></Link></section>;
}
