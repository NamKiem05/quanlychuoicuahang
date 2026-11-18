"use server";
import { randomBytes, createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { staffRoleLabels } from "@/lib/platform-staff-role";
import { sendPlatformStaffInvitation } from "@/lib/email/platform-staff-invitation";

export type InviteResult = { message: string; ok: boolean } | null;
async function authorized() {
  const client = await createClient();
  const userId = await requirePlatformAdminAccess(client);
  return { userId, admin: createAdminClient() };
}
function tokenPair() { const token = randomBytes(32).toString("hex"); return { token, hash: createHash("sha256").update(token).digest("hex") }; }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function inviteAdmin(_prev: InviteResult, formData: FormData): Promise<InviteResult> {
  const { userId, admin } = await authorized();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: "Vui lòng nhập email hợp lệ." };
  const role = String(formData.get("role") ?? "");
  if (!Object.hasOwn(staffRoleLabels, role)) return { ok: false, message: "Vui lòng chọn vai trò hợp lệ." };
  const expired = await admin.from("platform_staff_invitations").update({ status: "revoked" }).eq("email", email).eq("status", "pending").lt("expires_at", new Date().toISOString());
  if (expired.error) return { ok: false, message: "Chưa tạo được lời mời. Hãy kiểm tra cấu hình cơ sở dữ liệu." };
  const { token, hash } = tokenPair();
  const result = await admin.from("platform_staff_invitations").insert({ email, token_hash: hash, invited_by: userId, staff_role_label: role });
  if (result.error) return { ok: false, message: result.error.code === "23505" ? "Email này đã có lời mời đang chờ hoặc đang xử lý." : "Chưa tạo được lời mời. Hãy kiểm tra cấu hình cơ sở dữ liệu." };
  revalidatePath("/admin/admins");
  const sent = await sendPlatformStaffInvitation(email, token, role);
  return sent ? { ok: true, message: "Máy chủ email đã chấp nhận gửi lời mời. Nhân viên có thể kiểm tra cả thư rác." } : { ok: false, message: "Đã tạo lời mời nhưng chưa gửi được email. Kiểm tra SMTP và địa chỉ website, sau đó dùng nút Gửi lại." };
}
export async function resendAdminInvitation(_prev: InviteResult, formData: FormData): Promise<InviteResult> {
  const { admin } = await authorized();
  const id = String(formData.get("id") ?? "");
  if (!uuid.test(id)) return { ok: false, message: "Lời mời không hợp lệ." };
  const { token, hash } = tokenPair();
  const result = await admin.from("platform_staff_invitations").update({ token_hash: hash }).eq("id", id).eq("status", "pending").gt("expires_at", new Date().toISOString()).select("email, staff_role_label").maybeSingle();
  if (result.error || !result.data) return { ok: false, message: "Lời mời không còn hiệu lực hoặc đã được xử lý." };
  revalidatePath("/admin/admins");
  const sent = await sendPlatformStaffInvitation(result.data.email, token, result.data.staff_role_label);
  return sent ? { ok: true, message: "Máy chủ email đã chấp nhận gửi lại lời mời." } : { ok: false, message: "Chưa gửi được email. Kiểm tra SMTP và địa chỉ website rồi gửi lại." };
}
export async function revokeAdminInvitation(_prev: InviteResult, formData: FormData): Promise<InviteResult> {
  const { admin } = await authorized();
  const id = String(formData.get("id") ?? "");
  if (!uuid.test(id)) return { ok: false, message: "Lời mời không hợp lệ." };
  const result = await admin.from("platform_staff_invitations").update({ status: "revoked" }).eq("id", id).eq("status", "pending").select("id").maybeSingle();
  if (result.error || !result.data) return { ok: false, message: "Không thể hủy lời mời đã xử lý." };
  revalidatePath("/admin/admins");
  return { ok: true, message: "Đã hủy lời mời." };
}
