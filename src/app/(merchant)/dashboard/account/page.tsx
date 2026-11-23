"use client";

import Link from "next/link";
import { useActionState } from "react";
import { changeAccountPassword } from "../actions";

export default function DashboardAccountPage() {
  const [state, action, pending] = useActionState(changeAccountPassword, {});

  return (
    <main className="admin-content">
      <div className="admin-page-heading">
        <div>
          <h1 className="admin-page-title">Đổi mật khẩu</h1>
          <p className="dashboard-intro">Cập nhật mật khẩu tài khoản quản lý cửa hàng.</p>
        </div>
      </div>
      <section className="dashboard-card dashboard-account-password">
        <form className="dashboard-form" action={action}>
          <label>Mật khẩu hiện tại<input name="current_password" type="password" autoComplete="current-password" required /></label>
          <label>Mật khẩu mới<input name="new_password" type="password" autoComplete="new-password" minLength={8} required placeholder="Ít nhất 8 ký tự" /></label>
          <label>Nhập lại mật khẩu mới<input name="confirm_password" type="password" autoComplete="new-password" minLength={8} required /></label>
          {state.error && <p className="dashboard-account-error" role="alert">{state.error}</p>}
          {state.success && <p className="dashboard-account-success" role="status">Đã cập nhật mật khẩu.</p>}
          <button className="primary-button dashboard-submit" type="submit" disabled={pending}>{pending ? "Đang lưu…" : "Lưu mật khẩu"}</button>
        </form>
        <Link className="dashboard-account-back" href="/dashboard">← Về tổng quan</Link>
      </section>
    </main>
  );
}
