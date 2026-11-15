"use client";

import { grantPlatformAdmin } from "./actions";

export default function GrantAdminForm() {
  return (
    <form
      className="admin-admin-grant-form"
      action={grantPlatformAdmin}
      onSubmit={(event) => {
        const emailField = event.currentTarget.elements.namedItem("email");
        const email = emailField instanceof HTMLInputElement ? emailField.value.trim() : "";
        if (!window.confirm("Cấp quyền quản trị toàn nền tảng cho " + email + "?")) event.preventDefault();
      }}
    >
      <label>Email tài khoản<input type="email" name="email" required maxLength={254} placeholder="ten@email.com" autoComplete="off" /></label>
      <button className="approve-button" type="submit">Cấp quyền quản trị</button>
    </form>
  );
}
