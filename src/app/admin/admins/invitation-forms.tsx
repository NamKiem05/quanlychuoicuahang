"use client";
import { useActionState } from "react";
import { staffRoleLabels } from "@/lib/platform-staff-role";
import { inviteAdmin, resendAdminInvitation, revokeAdminInvitation } from "./invitations-actions";
export function InviteAdminForm() {
  const [state, action, pending] = useActionState(inviteAdmin, null);
  return <><form action={action} className="staff-invite-form"><label>Email nhân viên<input name="email" type="email" maxLength={254} required placeholder="nhanvien@example.com" /></label><label>Vai trò<select name="role" required defaultValue=""><option value="" disabled>Chọn vai trò</option>{Object.entries(staffRoleLabels).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label><button disabled={pending}>{pending ? "Đang gửi..." : "Gửi lời mời"}</button></form>{state && <p role="status" className={state.ok ? "staff-invite-success" : "staff-invite-error"}>{state.message}</p>}</>;
}
export function InvitationActions({ id, expired }: { id: string; expired: boolean }) {
  const [resend, sendAction, sending] = useActionState(resendAdminInvitation, null);
  const [revoke, revokeAction, revoking] = useActionState(revokeAdminInvitation, null);
  return <div className="staff-invitation-actions">{!expired && <form action={sendAction}><input type="hidden" name="id" value={id} /><button disabled={sending}>{sending ? "Đang gửi..." : "Gửi lại"}</button></form>}<form action={revokeAction} onSubmit={(event) => { if (!window.confirm("Hủy lời mời này?")) event.preventDefault(); }}><input type="hidden" name="id" value={id} /><button disabled={revoking}>Hủy lời mời</button></form>{(resend || revoke) && <small role="status">{(revoke || resend)?.message}</small>}</div>;
}
