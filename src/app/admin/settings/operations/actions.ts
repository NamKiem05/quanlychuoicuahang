"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";

type Result = { error?: string; success?: string } | null;
export async function saveOperations(_previous: Result, form: FormData): Promise<Result> {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const message = String(form.get("maintenance_message") ?? "").trim();
  const maxLength = Number(form.get("max_notification_length"));
  if (!message || message.length > 1000 || !Number.isInteger(maxLength) || maxLength < 100 || maxLength > 4000) return { error: "Nội dung bảo trì cần 1–1.000 ký tự; giới hạn thông báo cần từ 100 đến 4.000 ký tự." };
  const { data, error } = await supabase.from("platform_operations_settings").update({ maintenance_enabled: form.get("maintenance_enabled") === "on", maintenance_message: message, public_signup_enabled: form.get("public_signup_enabled") === "on", max_notification_length: maxLength, updated_at: new Date().toISOString() }).eq("id", true).select("id").maybeSingle();
  if (error || !data) return { error: "Chưa lưu được cấu hình. Kiểm tra migration và quyền quản trị." };
  revalidatePath("/admin/settings"); revalidatePath("/login"); revalidatePath("/admin/notifications");
  return { success: "Đã lưu cấu hình vận hành." };
}
