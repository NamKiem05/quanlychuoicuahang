"use client";

import { setAccountAccessStatus } from "./actions";

export default function AccountStatusForm({
  userId,
  suspended,
  search,
  status,
  page,
}: {
  userId: string;
  suspended: boolean;
  search: string;
  status: string;
  page: number;
}) {
  const action = suspended ? "reactivate" : "suspend";
  const label = suspended ? "Mở khóa" : "Khóa tài khoản";
  const confirmation = suspended
    ? "Mở khóa tài khoản này để người dùng có thể đăng nhập lại?"
    : "Khóa tài khoản này? Người dùng sẽ không thể đăng nhập cho đến khi được mở khóa.";

  return (
    <form action={setAccountAccessStatus}>
      <input type="hidden" name="user_id" value={userId} />
      <input type="hidden" name="account_action" value={action} />
      <input type="hidden" name="filter_q" value={search} />
      <input type="hidden" name="filter_status" value={status} />
      <input type="hidden" name="filter_page" value={page} />
      <button
        className={suspended ? "approve-button" : "quiet-action danger-action"}
        type="submit"
        onClick={(event) => {
          if (!window.confirm(confirmation)) event.preventDefault();
        }}
      >
        {label}
      </button>
    </form>
  );
}
