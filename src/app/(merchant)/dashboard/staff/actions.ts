"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireExpectedStore } from "@/lib/active-store";
import { getMerchantContext } from "../data";
import { applicationMailer } from "@/lib/email/smtp";

type Result = { error?: string; success?: string } | null;
async function owner(form: FormData) {
  const context = await getMerchantContext();
  if (!context.store || context.membership?.role !== "owner") return null;
  requireExpectedStore(form, context.store.id);
  return { supabase: context.supabase, store: context.store };
}
async function sendInvitationEmail(email: string, storeName: string) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) return { sent: false, reason: "Chưa cấu hình NEXT_PUBLIC_APP_URL là địa chỉ HTTPS công khai trên máy chủ." };
  let url: URL;
  try { url = new URL(configured); } catch { return { sent: false, reason: "NEXT_PUBLIC_APP_URL không phải địa chỉ website hợp lệ." }; }
  const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const localDevelopment = process.env.NODE_ENV === "development" && localHost && url.protocol === "http:";
  if ((!localDevelopment && (url.protocol !== "https:" || localHost || url.hostname.endsWith(".localhost"))) || url.username || url.password) return { sent: false, reason: "NEXT_PUBLIC_APP_URL cần là HTTPS công khai, hoặc localhost khi chạy môi trường phát triển." };
  const invitationUrl = new URL("/staff-invitations", url.origin).toString();
  try {
    const { transporter, from } = await applicationMailer();
    await transporter.sendMail({ from, to: email, subject: `Lời mời tham gia cửa hàng ${storeName} trên GrowDesk`, text: `Bạn được mời tham gia cửa hàng ${storeName} trên GrowDesk với vai trò nhân viên.\n\nMở ${invitationUrl} và đăng nhập bằng chính địa chỉ email nhận thư. Nếu chưa có tài khoản, hãy đăng ký và xác minh email trước khi chấp nhận lời mời.${localDevelopment ? "\n\nĐây là liên kết thử nghiệm localhost, chỉ mở được trên máy đang chạy GrowDesk." : ""}\n\nLời mời có hiệu lực 7 ngày. Nếu bạn không mong đợi lời mời này, bạn có thể bỏ qua email.` });
    return { sent: true, reason: "" };
  } catch { return { sent: false, reason: "Không kết nối hoặc gửi được qua SMTP. Kiểm tra cấu hình email ứng dụng." }; }
}
export async function inviteStaff(_previous: Result, form: FormData): Promise<Result> {
  const context = await owner(form);
  if (!context) return { error: "Chỉ chủ cửa hàng mới có thể thêm nhân viên." };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Hãy nhập địa chỉ email hợp lệ." };
  const { error } = await context.supabase.rpc("owner_invite_store_staff", { target_store: context.store.id, target_email: email });
  if (error?.code === "23505") return { error: "Email đã là thành viên hoặc đang có lời mời còn hiệu lực." };
  if (error) return { error: "Chưa tạo được lời mời. Hãy kiểm tra cấu hình và thử lại." };
  revalidatePath("/dashboard/staff");
  const sent = await sendInvitationEmail(email, context.store.name);
  return sent.sent ? { success: "Đã tạo lời mời và máy chủ email đã chấp nhận gửi thư cho nhân viên." } : { error: `Đã tạo lời mời nhưng chưa gửi được email. ${sent.reason} Không tạo lại; hãy dùng nút Gửi lại sau khi sửa cấu hình.` };
}
export async function resendStaffInvitation(_previous: Result, form: FormData): Promise<Result> {
  const context = await owner(form);
  if (!context) return { error: "Chỉ chủ cửa hàng mới có thể gửi lại lời mời." };
  const id = String(form.get("invitation_id") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return { error: "Lời mời không hợp lệ." };
  const result = await context.supabase.from("store_staff_invitations").select("email").eq("id", id).eq("store_id", context.store.id).eq("status", "pending").gt("expires_at", new Date().toISOString()).maybeSingle();
  if (result.error || !result.data) return { error: "Lời mời không còn hiệu lực hoặc không tìm thấy." };
  const sent = await sendInvitationEmail(result.data.email, context.store.name);
  return sent.sent ? { success: "Máy chủ email đã chấp nhận gửi lại lời mời." } : { error: `Chưa gửi được email. ${sent.reason}` };
}
export async function removeStaff(form: FormData) {
  const context = await owner(form);
  if (!context) redirect("/dashboard/staff?message=failed");
  const id = String(form.get("user_id") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) redirect("/dashboard/staff?message=failed");
  const { error } = await context.supabase.rpc("owner_revoke_store_staff", { target_store: context.store.id, target_user: id });
  revalidatePath("/dashboard/staff");
  redirect(`/dashboard/staff?message=${error ? "failed" : "removed"}`);
}
export async function cancelInvite(form: FormData) {
  const context = await owner(form);
  if (!context) redirect("/dashboard/staff?message=failed");
  const id = String(form.get("invitation_id") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) redirect("/dashboard/staff?message=failed");
  const { error } = await context.supabase.rpc("owner_cancel_staff_invite", { target_store: context.store.id, invite_id: id });
  revalidatePath("/dashboard/staff");
  redirect(`/dashboard/staff?message=${error ? "failed" : "cancelled"}`);
}
