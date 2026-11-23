"use client";
import { useActionState } from "react";
import { cancelInvite, inviteStaff, removeStaff, resendStaffInvitation } from "./actions";

export function InviteStaff() {
  const [result, action, pending] = useActionState(inviteStaff, null);
  return <form className="store-staff-invite" action={action}><label>Email nhân viên<input type="email" name="email" maxLength={254} required placeholder="nhanvien@example.com" /></label><button type="submit" disabled={pending}>{pending ? "Đang tạo…" : "Tạo lời mời"}</button>{result?.error && <p className="store-staff-error" role="alert">{result.error}</p>}{result?.success && <p className="store-staff-success" role="status">{result.success}</p>}</form>;
}
export function RemoveStaff({ userId, name }: { userId: string; name: string }) {
  return <form action={removeStaff} onSubmit={(event) => { if (!window.confirm(`Gỡ ${name} khỏi cửa hàng này?`)) event.preventDefault(); }}><input type="hidden" name="user_id" value={userId} /><button className="store-staff-danger" type="submit">Gỡ nhân viên</button></form>;
}
export function CancelInvite({ id, email }: { id: string; email: string }) {
  return <form action={cancelInvite} onSubmit={(event) => { if (!window.confirm(`Hủy lời mời cho ${email}?`)) event.preventDefault(); }}><input type="hidden" name="invitation_id" value={id} /><button className="store-staff-danger" type="submit">Hủy lời mời</button></form>;
}
export function ResendInvite({ id }: { id: string }) {
  const [result, action, pending] = useActionState(resendStaffInvitation, null);
  return <form className="store-staff-resend" action={action}><input type="hidden" name="invitation_id" value={id} /><button type="submit" disabled={pending}>{pending ? "Đang gửi…" : "Gửi lại email"}</button>{result?.error && <p className="store-staff-error" role="alert">{result.error}</p>}{result?.success && <p className="store-staff-success" role="status">{result.success}</p>}</form>;
}
