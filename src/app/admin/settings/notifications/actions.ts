"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";

type Result = { success?: string; error?: string } | null;
export async function saveNotificationSettings(_previous: Result, form: FormData): Promise<Result> {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const maintenanceTitle = String(form.get("maintenance_title") ?? "").trim();
  const maintenanceBody = String(form.get("maintenance_body") ?? "").trim();
  const paymentTitle = String(form.get("payment_title") ?? "").trim();
  const paymentBody = String(form.get("payment_body") ?? "").trim();
  if ([maintenanceTitle, paymentTitle].some((value) => value.length < 3 || value.length > 160) || [maintenanceBody, paymentBody].some((value) => !value || value.length > 4000)) return { error: "Tiêu đề cần 3–160 ký tự; nội dung cần 1–4.000 ký tự." };
  const { data, error } = await supabase.from("platform_notification_settings").update({ in_app_enabled: form.get("in_app_enabled") === "on", maintenance_enabled: form.get("maintenance_enabled") === "on", payment_enabled: form.get("payment_enabled") === "on", maintenance_title: maintenanceTitle, maintenance_body: maintenanceBody, payment_title: paymentTitle, payment_body: paymentBody, updated_at: new Date().toISOString() }).eq("id", true).select("id").maybeSingle();
  if (error || !data) return { error: "Chưa lưu được cấu hình. Hãy kiểm tra migration và quyền quản trị." };
  revalidatePath("/admin/settings"); revalidatePath("/admin/notifications");
  return { success: "Đã lưu cấu hình thông báo trong ứng dụng và nội dung mẫu." };
}
