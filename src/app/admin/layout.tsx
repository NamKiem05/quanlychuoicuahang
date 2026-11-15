import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AdminSidebar from "./admin-sidebar";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  if (!authData?.claims?.sub) redirect("/login");

  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) {
    return (
      <main className="dashboard-page">
        <header className="dashboard-header">
          <a className="brand" href="/"><span className="brand-mark">M</span><span className="brand-name">bếp nhà mơ<span>.</span></span></a>
          <a className="signout-button" href="/dashboard">Khu vực cửa hàng</a>
        </header>
        <section className="admin-locked">
          <span>⌑</span>
          <h1>Khu vực dành cho quản trị viên</h1>
          <p>Tài khoản của bạn chưa có quyền quản trị nền tảng. Cấp quyền admin qua Supabase SQL Editor rồi tải lại trang này.</p>
          <a className="primary-button" href="/dashboard">Quay lại khu vực cửa hàng <span>→</span></a>
        </section>
      </main>
    );
  }

  return (
    <div className="admin-app-shell">
      <AdminSidebar />
      <div className="admin-workspace">
        <header className="admin-topbar">
          <span>QUẢN TRỊ NỀN TẢNG</span>
          <a href="/">Xem trang khách ↗</a>
        </header>
        <div className="admin-page-content">{children}</div>
      </div>
    </div>
  );
}
