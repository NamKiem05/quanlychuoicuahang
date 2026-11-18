import "server-only";
import { staffRoleLabels } from "@/lib/platform-staff-role";
import { applicationMailer } from "./smtp";

export async function sendPlatformStaffInvitation(email: string, token: string, role?: string | null) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) return false;
  let url: URL;
  try { url = new URL(configured); } catch { return false; }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const localDevelopment = process.env.NODE_ENV === "development" && local && url.protocol === "http:";
  if ((!localDevelopment && (url.protocol !== "https:" || local || url.hostname.endsWith(".localhost"))) || url.username || url.password) return false;
  const invitationUrl = `${new URL("/platform-invitation", url.origin)}#${token}`;
  try {
    const { transporter, from } = await applicationMailer();
    await transporter.sendMail({ from, to: email, subject: "Lời mời tham gia đội ngũ GrowDesk", text: `Bạn được mời tham gia đội ngũ quản trị GrowDesk.${role && Object.hasOwn(staffRoleLabels, role) ? `\nVai trò: ${staffRoleLabels[role]}` : ""}\n\nMở liên kết sau để xác nhận lời mời và tự đặt mật khẩu:\n${invitationUrl}\n\nTài khoản mới chưa có quyền quản trị; quản trị viên sẽ cấp quyền riêng sau khi bạn chấp nhận. Lời mời có hiệu lực 7 ngày.${localDevelopment ? "\n\nĐây là liên kết localhost, chỉ dùng trên máy đang chạy dự án." : ""}\n\nNếu bạn không mong đợi lời mời, hãy bỏ qua email này.` });
    return true;
  } catch { return false; }
}
