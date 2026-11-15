import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import AdminSidebar from "./admin-sidebar";
import AdminChatNotificationsProvider from "./admin-chat-notifications";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="admin-platform-loading" role="status">Đang xác minh quyền quản trị…</div>}>
      <AdminRequestLayout>{children}</AdminRequestLayout>
    </Suspense>
  );
}

async function AdminRequestLayout({ children }: { children: ReactNode }) {
  await connection();
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  if (!authData?.claims?.sub) redirect("/login");

  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) {
    return (
      <main className="dashboard-page">
        <header className="dashboard-header">
          <Link className="brand" href="/"><span className="brand-mark">M</span><span className="brand-name">bếp nhà mơ<span>.</span></span></Link>
          <Link className="signout-button" href="/dashboard">Khu vực cửa hàng</Link>
        </header>
        <section className="admin-locked">
          <span>⌑</span>
          <h1>Khu vực dành cho quản trị viên</h1>
          <p>Tài khoản của bạn chưa có quyền quản trị nền tảng. Cấp quyền admin qua Supabase SQL Editor rồi tải lại trang này.</p>
          <Link className="primary-button" href="/dashboard">Quay lại khu vực cửa hàng <span>→</span></Link>
        </section>
      </main>
    );
  }

  const { data: stores } = await supabase.from("stores").select("id, name").order("name");

  return (
    <AdminChatNotificationsProvider stores={stores ?? []}>
      <div className="admin-app-shell admin-platform-shell">
        <AdminSidebar />
        <div className="admin-workspace">
          <header className="admin-topbar">
            <form className="admin-topbar-search" action="/admin/orders" method="get">
              <span aria-hidden="true">⌕</span>
              <input type="search" name="q" placeholder="Tìm mã đơn, khách hàng..." aria-label="Tìm đơn hàng hoặc khách hàng" />
              <kbd>Enter</kbd>
            </form>
            <div className="admin-topbar-actions">
              <Link className="admin-topbar-store-link" href="/">Trang giới thiệu ↗</Link>
              <div className="admin-topbar-profile" aria-label="Tài khoản quản trị viên">
                <span className="admin-topbar-avatar">Q</span>
                <span><b>Quản trị viên</b><small>Admin nền tảng</small></span>
              </div>
            </div>
          </header>
          <div className="admin-page-content">{children}</div>
        </div>
      </div>
    </AdminChatNotificationsProvider>
  );
}
