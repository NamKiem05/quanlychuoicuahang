"use server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { staffRoleLabels } from "@/lib/platform-staff-role";
import { createAdminClient } from "@/lib/supabase/admin";
export type AcceptResult = { ok: boolean; message: string } | null;
export async function acceptInvitation(_previous: AcceptResult, formData: FormData): Promise<AcceptResult> {
  const token = String(formData.get("token") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!/^[a-f0-9]{64}$/.test(token)) return { ok: false, message: "Liên kết lời mời không hợp lệ. Hãy mở lại liên kết trong email." };
  if (name.length < 2 || name.length > 120) return { ok: false, message: "Nhập tên từ 2 đến 120 ký tự." };
  if (password !== formData.get("confirm_password")) return { ok: false, message: "Hai mật khẩu không khớp." };
  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch { return { ok: false, message: "Máy chủ chưa sẵn sàng. Vui lòng liên hệ quản trị viên." }; }
  const policy = await admin.from("platform_security_settings").select("staff_password_min_length").eq("id", true).maybeSingle();
  const missingPolicy = policy.error && ["42P01", "PGRST205"].includes(policy.error.code);
  if ((policy.error && !missingPolicy) || (!policy.error && !policy.data)) return { ok: false, message: "Không kiểm tra được chính sách mật khẩu. Vui lòng thử lại sau." };
  const min = missingPolicy ? 12 : Number(policy.data?.staff_password_min_length);
  if (!Number.isInteger(min) || min < 12 || min > 64) return { ok: false, message: "Chính sách mật khẩu chưa hợp lệ. Vui lòng liên hệ quản trị viên." };
  if (password.length < min || Buffer.byteLength(password, "utf8") > 72) return { ok: false, message: `Mật khẩu cần ít nhất ${min} ký tự và tối đa 72 byte.` };
  const reserved = await admin.rpc("reserve_platform_staff_invitation", { requested_hash: createHash("sha256").update(token).digest("hex") });
  const invitation = reserved.data?.[0];
  if (reserved.error || !invitation) return { ok: false, message: "Lời mời đã hết hạn, đã được sử dụng hoặc không hợp lệ. Hãy liên hệ quản trị viên." };
  const roleResult = await admin.from("platform_staff_invitations").select("staff_role_label").eq("id", invitation.id).eq("status", "processing").maybeSingle();
  if (roleResult.error || !roleResult.data) return { ok: false, message: "Chưa kiểm tra được vai trò trong lời mời. Hãy liên hệ quản trị viên." };
  const role = roleResult.data.staff_role_label;
  if (role !== null && !Object.hasOwn(staffRoleLabels, role)) return { ok: false, message: "Vai trò trong lời mời không hợp lệ. Hãy liên hệ quản trị viên." };
  let result;
  try { result = await admin.auth.admin.createUser({ email: invitation.email, password, email_confirm: true, app_metadata: { account_kind: "platform_admin", staff_role_label: role }, user_metadata: { display_name: name } }); }
  catch { return { ok: false, message: "Chưa xác nhận được kết quả tạo tài khoản. Hãy liên hệ quản trị viên để kiểm tra trước khi thử lại." }; }
  if (result.error?.code === "email_exists" || result.error?.code === "user_already_exists") {
    await admin.from("platform_staff_invitations").update({ status: "pending" }).eq("id", invitation.id).eq("status", "processing");
    return { ok: false, message: "Email này đã có tài khoản. Hãy liên hệ quản trị viên và sử dụng email riêng chưa đăng ký." };
  }
  if (result.error || !result.data.user) return { ok: false, message: "Chưa xác nhận được kết quả tạo tài khoản. Hãy liên hệ quản trị viên để kiểm tra trước khi thử lại." };
  const finished = await admin.from("platform_staff_invitations").update({ status: "accepted", accepted_user_id: result.data.user.id, accepted_at: new Date().toISOString() }).eq("id", invitation.id).eq("status", "processing").select("id").maybeSingle();
  revalidatePath("/admin/admins");
  if (finished.error || !finished.data) return { ok: false, message: "Tài khoản đã được tạo nhưng chưa cập nhật trạng thái lời mời. Hãy liên hệ quản trị viên; không tạo lại tài khoản." };
  return { ok: true, message: "Bạn đã chấp nhận lời mời và tạo tài khoản. Hãy liên hệ quản trị viên để được cấp quyền trước khi đăng nhập." };
}
