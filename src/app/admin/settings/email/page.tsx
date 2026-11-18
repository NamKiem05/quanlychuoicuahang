import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { readSmtpSettings } from "@/lib/email/smtp";
import EmailForm from "./email-form";
import "../settings.css";

export default async function EmailSettingsPage() {
  await requirePlatformAdminAccess(await createClient());
  let settings;
  try { settings = await readSmtpSettings(); } catch { return <main className="admin-content platform-settings-page"><header><h1>Cấu hình email</h1></header><p className="platform-settings-error" role="alert">Chưa tải được cấu hình email. Kiểm tra migration 202611180021_platform_email_settings.sql và cấu hình service role trên máy chủ.</p></main>; }
  const values = settings ? { smtp_host: settings.smtp_host, smtp_port: settings.smtp_port, smtp_username: settings.smtp_username, sender_email: settings.sender_email, sender_name: settings.sender_name } : null;
  return <main className="admin-content platform-settings-page"><header><div className="dashboard-kicker">HỆ THỐNG / CẤU HÌNH EMAIL</div><h1>Cấu hình email</h1><p>Thiết lập email ứng dụng và gửi thử kết nối.</p><p><Link href="/admin/settings">← Cấu hình chung</Link></p></header><p className="platform-settings-note">Email xác minh tài khoản và đặt lại mật khẩu do Supabase Auth gửi; bạn cần cấu hình SMTP riêng trong Supabase. Cấu hình tại đây được dùng cho email đơn hàng của ứng dụng.</p><EmailForm values={values} /></main>;
}
