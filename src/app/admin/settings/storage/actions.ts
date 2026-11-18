"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";

type Result = { error?: string; success?: string } | null;
export async function saveStorageSettings(_previous: Result, form: FormData): Promise<Result> {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const frequency = String(form.get("backup_frequency") ?? "");
  const time = String(form.get("backup_time") ?? "");
  const weekday = Number(form.get("backup_weekday"));
  const monthday = Number(form.get("backup_monthday"));
  const retention = Number(form.get("retention_days"));
  const notes = String(form.get("notes") ?? "").trim();
  if (!["none", "daily", "weekly", "monthly"].includes(frequency) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !Number.isInteger(weekday) || weekday < 1 || weekday > 7 || !Number.isInteger(monthday) || monthday < 1 || monthday > 28 || !Number.isInteger(retention) || retention < 1 || retention > 3650 || notes.length > 1000) return { error: "Hãy kiểm tra lịch dự kiến, thời gian lưu giữ và ghi chú." };
  const { data, error } = await supabase.from("platform_storage_settings").update({ backup_frequency: frequency, backup_time: time, backup_weekday: weekday, backup_monthday: monthday, retention_days: retention, notes, updated_at: new Date().toISOString() }).eq("id", true).select("id").maybeSingle();
  if (error || !data) return { error: "Chưa lưu được thông tin. Kiểm tra migration và quyền quản trị." };
  revalidatePath("/admin/settings");
  return { success: "Đã lưu lịch và chính sách dự kiến. Hệ thống không tự chạy sao lưu hoặc xóa tệp." };
}
