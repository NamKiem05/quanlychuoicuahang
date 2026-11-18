"use client";

import { useFormStatus } from "react-dom";
import { grantPlatformAdmin } from "./actions";

function AdminSubmit() {
  const { pending } = useFormStatus();
  return <button className="approve-button" type="submit" disabled={pending}>{pending ? "Đang lưu…" : "Cấp quyền admin toàn nền tảng"}</button>;
}

export default function GrantAdminForm() {
  return (
    <form
      className="admin-admin-grant-form"
      action={grantPlatformAdmin}
      onSubmit={(event) => {
        const emailField = event.currentTarget.elements.namedItem("email");
        const email = emailField instanceof HTMLInputElement ? emailField.value.trim() : "";
        if (!window.confirm(`Cấp lại quyền quản trị toàn nền tảng cho ${email}?`)) event.preventDefault();
      }}
    >
      <label>Email nhân viên<input type="email" name="email" required maxLength={254} placeholder="ten@email.com" autoComplete="off" /></label>
      <AdminSubmit />
    </form>
  );
}
