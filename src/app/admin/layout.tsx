import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import AdminNavigation from "./admin-navigation";
import LoadingScreen from "@/components/ui/loading-screen";
import AdminChatNotificationsProvider from "./admin-chat-notifications";
import { signOut } from "@/app/(merchant)/dashboard/actions";
import "./admin-navigation.css";
import { defaultPlatformSettings, getPlatformSettings } from "@/lib/platform-settings";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <AdminRequestLayout>{children}</AdminRequestLayout>
    </Suspense>
  );
}

async function AdminRequestLayout({ children }: { children: ReactNode }) {
  await connection();
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  if (!authData?.claims?.sub) redirect("/login");

  const [{ settings }, { data: isAdmin }] = await Promise.all([getPlatformSettings(), supabase.rpc("is_platform_admin")]);
  const branding = settings ?? defaultPlatformSettings;
  const support = isAdmin ? null : await supabase.rpc("has_support_ticket_permission");
  const supportOnly = !isAdmin && support?.data === true && !support.error;
  if (!isAdmin && !supportOnly) {
    const { data: access } = await supabase.rpc("platform_account_access");
    const inactive = access === "admin_inactive";
    return (
      <main className="dashboard-page">
        <header className="dashboard-header">
          <Link className="brand" href="/" aria-label={`${branding.platform_name} - trang giới thiệu`}>{branding.logo_url && <Image src={branding.logo_url} width={180} height={72} alt="" unoptimized style={{ objectFit: "contain" }} />}</Link>
          <Link className="signout-button" href={inactive ? "/" : "/dashboard"}>{inactive ? "Trang chủ" : "Khu vực cửa hàng"}</Link>
          <form action={signOut}><button className="signout-button" type="submit">Đăng xuất</button></form>
        </header>
        <section className="admin-locked">
          <span>⌑</span>
          <h1>Khu vực dành cho quản trị viên</h1>
          <p>{inactive ? "Tài khoản admin này chưa có quyền truy cập. Hãy liên hệ quản trị viên nền tảng." : "Khu vực này dành cho tài khoản quản trị riêng."}</p>
          <Link className="primary-button" href={inactive ? "/" : "/dashboard"}>{inactive ? "Về trang chủ" : "Quay lại khu vực cửa hàng"} <span>→</span></Link>
        </section>
      </main>
    );
  }

  const { data: stores } = await supabase.from("stores").select("id, name").order("name");
  return (
    <AdminChatNotificationsProvider stores={stores ?? []}>
      <div className="admin-app-shell admin-platform-shell">
        <AdminNavigation supportOnly={supportOnly} platformName={branding.platform_name} logoUrl={branding.logo_url} />
        <div className="admin-workspace">
          <header className="admin-topbar">
            {!supportOnly && <form className="admin-topbar-search" action="/admin/orders" method="get">
              <span aria-hidden="true">⌕</span>
              <input type="search" name="q" placeholder="Tìm mã đơn, khách hàng..." aria-label="Tìm đơn hàng hoặc khách hàng" />
              <kbd>Enter</kbd>
            </form>}
            <div className="admin-topbar-actions">
              <Link className="admin-topbar-store-link" href="/">Trang giới thiệu ↗</Link>
              <div className="admin-topbar-profile" aria-label="Tài khoản quản trị viên">
                <span className="admin-topbar-avatar">Q</span>
                <span><b>{supportOnly ? "Nhân viên hỗ trợ" : "Quản trị viên"}</b><small>{supportOnly ? "Hỗ trợ ticket" : "Admin nền tảng"}</small></span>
              </div>
              <form action={signOut}><button className="secondary-submit" type="submit">Đăng xuất</button></form>
            </div>
          </header>
          <div className="admin-page-content"><Suspense fallback={<LoadingScreen contained />}>{children}</Suspense></div>
        </div>
      </div>
    </AdminChatNotificationsProvider>
  );
}
