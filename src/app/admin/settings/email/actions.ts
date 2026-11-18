"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { encryptSmtpPassword, makeSmtpTransport, readSmtpSettings } from "@/lib/email/smtp";

type Result = { error?: string; success?: string } | null;
async function authorize() { await requirePlatformAdminAccess(await createClient()); }
const validEmail = (email: string) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
function testError(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const command = typeof error === "object" && error !== null && "command" in error ? String(error.command) : "";
  const response = typeof error === "object" && error !== null && "responseCode" in error ? Number(error.responseCode) : 0;
  const message = error instanceof Error ? error.message : "";
  if (message.includes("SMTP_SETTINGS_ENCRYPTION_KEY")) return "Máy chủ chưa có khóa mã hóa SMTP hợp lệ. Hãy kiểm tra biến môi trường và khởi động lại ứng dụng.";
  if (message.includes("authenticate data") || message.includes("giải mã") || code === "ERR_CRYPTO_INVALID_AUTH_TAG") return "Không giải mã được mật khẩu SMTP. Khóa mã hóa có thể đã thay đổi; hãy nhập lại mật khẩu SMTP và lưu.";
  if (message.includes("địa chỉ Internet công khai")) return "Host SMTP phải phân giải đến địa chỉ Internet công khai.";
  if (["ENOTFOUND", "ENODATA", "EAI_AGAIN", "ETIMEOUT"].includes(code) && !command) return "Không phân giải được host SMTP hoặc DNS không phản hồi. Hãy kiểm tra tên máy chủ.";
  if (code === "EAUTH" || command.startsWith("AUTH") || response === 535 || response === 534) return "Máy chủ SMTP từ chối đăng nhập. Kiểm tra username và mật khẩu ứng dụng SMTP của nhà cung cấp.";
  if (["ETIMEDOUT", "ECONNECTION", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "ESOCKET"].includes(code)) return "Không kết nối được máy chủ SMTP. Kiểm tra host, cổng và việc mạng hoặc nhà cung cấp chặn kết nối ra ngoài.";
  if (code === "ETLS" || code.startsWith("CERT_") || code.includes("CERTIFICATE") || code.startsWith("ERR_TLS")) return "Kết nối TLS tới SMTP không hợp lệ. Kiểm tra host, cổng và chứng chỉ máy chủ.";
  if (command === "MAIL FROM" || command === "RCPT TO" || response >= 500) return "Máy chủ SMTP từ chối địa chỉ gửi hoặc nhận. Kiểm tra email gửi đã được nhà cung cấp cho phép và địa chỉ nhận thử.";
  return "Chưa gửi được email thử. Kiểm tra cấu hình SMTP, khóa mã hóa, kết nối và quyền của tài khoản gửi.";
}
export async function saveEmailSettings(_previous: Result, form: FormData): Promise<Result> {
  await authorize();
  const host = String(form.get("smtp_host") ?? "").trim().toLowerCase();
  const port = Number(form.get("smtp_port"));
  const username = String(form.get("smtp_username") ?? "").trim();
  const password = String(form.get("smtp_password") ?? "");
  const email = String(form.get("sender_email") ?? "").trim();
  const name = String(form.get("sender_name") ?? "").trim();
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(host) || ![465, 587, 2525].includes(port) || !username || username.length > 254 || password.length > 1024 || !validEmail(email) || !name || name.length > 100 || /[\r\n]/.test(name)) return { error: "Hãy kiểm tra máy chủ, cổng, tài khoản và địa chỉ gửi." };
  try {
    const current = await readSmtpSettings();
    if (!password && !current) return { error: "Hãy nhập mật khẩu SMTP." };
    const encrypted = password ? encryptSmtpPassword(password) : current!.password_ciphertext;
    const { error } = await createAdminClient().from("platform_email_settings").upsert({ id: true, smtp_host: host, smtp_port: port, smtp_username: username, password_ciphertext: encrypted, sender_email: email, sender_name: name, updated_at: new Date().toISOString() });
    if (error) return { error: "Chưa lưu được cấu hình email. Hãy kiểm tra migration và kết nối." };
    revalidatePath("/admin/settings/email");
    revalidatePath("/admin/settings");
    return { success: "Đã lưu cấu hình SMTP. Bạn có thể gửi email thử bên dưới." };
  } catch (error) { return { error: error instanceof Error && error.message.includes("SMTP_SETTINGS_ENCRYPTION_KEY") ? error.message : "Chưa lưu được cấu hình. Hãy kiểm tra khóa mã hóa và cơ sở dữ liệu." }; }
}
export async function sendTestEmail(_previous: Result, form: FormData): Promise<Result> {
  await authorize();
  const recipient = String(form.get("recipient") ?? "").trim();
  if (!validEmail(recipient)) return { error: "Nhập địa chỉ email nhận thử hợp lệ." };
  try {
    const settings = await readSmtpSettings();
    if (!settings) return { error: "Hãy lưu cấu hình SMTP trước khi gửi thử." };
    const { transporter, from } = await makeSmtpTransport(settings);
    await transporter.sendMail({ from, to: recipient, subject: "GrowDesk · Kiểm tra cấu hình email", text: "Đây là email kiểm tra cấu hình SMTP của nền tảng GrowDesk." });
    return { success: `Máy chủ gửi đã chấp nhận email thử đến ${recipient}.` };
  } catch (error) { return { error: testError(error) }; }
}
