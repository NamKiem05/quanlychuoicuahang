import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { getPlatformSettings } from "@/lib/platform-settings";
import SettingsForm from "./settings-form";
import "./settings.css";
import { readSmtpSettings } from "@/lib/email/smtp";
import EmailForm from "./email/email-form";
import PaymentForm from "./payment/payment-form";
import { getMerchantPlanWebhookSecret, getPlatformBankAccount } from "@/lib/merchant-billing";
import SecurityForm from "./security/security-form";
import NotificationSettingsForm from "./notifications/notification-settings-form";
import StorageForm, { type BucketInfo } from "./storage/storage-form";
import { createAdminClient } from "@/lib/supabase/admin";
import OperationsForm from "./operations/operations-form";
import IntegrationsPanel from "./integrations/integrations-panel";

export default async function GeneralSettingsPage() {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const { settings, error } = await getPlatformSettings();
  let emailSettings = null;
  let emailError = false;
  try { emailSettings = await readSmtpSettings(); } catch { emailError = true; }
  const emailValues = emailSettings ? { smtp_host: emailSettings.smtp_host, smtp_port: emailSettings.smtp_port, smtp_username: emailSettings.smtp_username, sender_email: emailSettings.sender_email, sender_name: emailSettings.sender_name } : null;
  const paymentSettings = await supabase.from("platform_payment_settings").select("sepay_enabled").eq("id", true).maybeSingle();
  const securitySettings = await supabase.from("platform_security_settings").select("staff_password_min_length").eq("id", true).maybeSingle();
  const notificationSettings = await supabase.from("platform_notification_settings").select("in_app_enabled, maintenance_enabled, payment_enabled, maintenance_title, maintenance_body, payment_title, payment_body").eq("id", true).maybeSingle();
  const operationsSettings = await supabase.from("platform_operations_settings").select("maintenance_enabled, maintenance_message, public_signup_enabled, max_notification_length").eq("id", true).maybeSingle();
  const [storageSettings, latestBackup] = await Promise.all([
    supabase.from("platform_storage_settings").select("backup_frequency, backup_time, backup_weekday, backup_monthday, retention_days, notes").eq("id", true).maybeSingle(),
    supabase.from("backup_records").select("scope, result, completed_at, reference").order("completed_at", { ascending: false }).order("id").limit(1).maybeSingle(),
  ]);
  let buckets: BucketInfo[] | null = null;
  try {
    const response = await createAdminClient().storage.listBuckets();
    if (!response.error) buckets = response.data.map((bucket) => ({ id: bucket.id, public: bucket.public, file_size_limit: typeof bucket.file_size_limit === "number" ? bucket.file_size_limit : null, allowed_mime_types: bucket.allowed_mime_types ?? null }));
  } catch { /* Storage is optional until the service role is configured. */ }
  const bank = getPlatformBankAccount();
  let webhookUrl: string | null = null;
  let publicBaseUrl: string | null = null;
  try { const base = new URL(process.env.NEXT_PUBLIC_APP_URL ?? ""); if (["http:", "https:"].includes(base.protocol) && !base.username && !base.password) { publicBaseUrl = base.origin; webhookUrl = new URL("/api/webhooks/sepay-merchant-plan", base).toString(); } } catch { /* Missing or invalid public URL. */ }
  return <main className="admin-content platform-settings-page"><header><div className="dashboard-kicker">HỆ THỐNG / CẤU HÌNH</div><h1>Cấu hình hệ thống</h1><p>Quản lý thông tin nền tảng, email, thanh toán, bảo mật và thông báo.</p></header>{error || !settings ? <p className="platform-settings-error" role="alert">Chưa tải được cấu hình chung. Hãy chạy migration 202611180020_platform_general_settings.sql và tải lại trang.</p> : <SettingsForm settings={settings} />}{emailError ? <p className="platform-settings-error" role="alert">Chưa tải được cấu hình email. Kiểm tra migration 202611180021_platform_email_settings.sql và service role.</p> : <><p className="platform-settings-note">Email xác minh tài khoản và đặt lại mật khẩu do Supabase Auth gửi và cần cấu hình SMTP riêng trong Supabase. Cấu hình bên dưới dùng cho email đơn hàng của ứng dụng.</p><EmailForm values={emailValues} /></>}{paymentSettings.error || !paymentSettings.data ? <p className="platform-settings-error" role="alert">Chưa tải được cấu hình thanh toán. Kiểm tra migration 202611180022_platform_payment_settings.sql.</p> : <PaymentForm enabled={paymentSettings.data.sepay_enabled} bankLabel={bank ? `${bank.bank_name} · ${bank.account_number} · ${bank.account_name}` : "Chưa cấu hình"} webhookUrl={webhookUrl} webhookReady={Boolean(getMerchantPlanWebhookSecret())} />}<SecurityForm minLength={securitySettings.error ? null : securitySettings.data?.staff_password_min_length ?? null} /><NotificationSettingsForm settings={notificationSettings.error ? null : notificationSettings.data ?? null} /><StorageForm settings={storageSettings.error ? null : storageSettings.data ?? null} buckets={buckets} latestBackup={latestBackup.data ?? null} backupError={Boolean(latestBackup.error)} /><OperationsForm settings={operationsSettings.error ? null : operationsSettings.data ?? null} /><IntegrationsPanel publicBaseUrl={publicBaseUrl} sepayConfigured={Boolean(getMerchantPlanWebhookSecret())} smtpConfigured={emailError ? null : Boolean(emailSettings)} storageAvailable={buckets !== null} /></main>;
}
