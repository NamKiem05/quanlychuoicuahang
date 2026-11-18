"use client";
import { setSupportStaffRole } from "../admins/actions";

export default function SupportRoleForm() {
  return <form className="roles-support-form" action={setSupportStaffRole} onSubmit={(event) => {
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const operation = submitter?.value;
    const emailField = event.currentTarget.elements.namedItem("email");
    const email = emailField instanceof HTMLInputElement ? emailField.value.trim() : "nhân viên";
    if (!window.confirm(`${operation === "revoke" ? "Thu hồi" : "Cấp"} quyền hỗ trợ ticket cho ${email}?`)) event.preventDefault();
  }}><label>Email nhân viên<input type="email" name="email" required maxLength={254} placeholder="ten@email.com" autoComplete="off" /></label><div><button type="submit" name="operation" value="grant">Cấp quyền hỗ trợ</button><button type="submit" name="operation" value="revoke">Thu hồi quyền hỗ trợ</button></div></form>;
}
