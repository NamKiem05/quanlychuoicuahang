"use client";

import { revokePlatformAdmin } from "./actions";

export default function RevokeAdminForm({ userId, email }: { userId: string; email: string }) {
  return (
    <form action={revokePlatformAdmin}>
      <input type="hidden" name="user_id" value={userId} />
      <button
        className="quiet-action danger-action"
        type="submit"
        onClick={(event) => {
          if (!window.confirm("Thu hồi quyền quản trị nền tảng của " + email + "? Tài khoản sẽ chuyển về danh sách tài khoản thường.")) {
            event.preventDefault();
          }
        }}
      >
        Thu hồi quyền
      </button>
    </form>
  );
}
