"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";

type Result = { success?: string; error?: string } | null;
export async function saveSecuritySettings(_previous: Result, form: FormData): Promise<Result> {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const length = Number(form.get("staff_password_min_length"));
  if (!Number.isInteger(length) || length < 12 || length > 64) return { error: "Độ dài tối thiểu phải từ 12 đến 64 ký tự." };
  const { data, error } = await supabase.from("platform_security_settings").update({ staff_password_min_length: length, updated_at: new Date().toISOString() }).eq("id", true).select("id").maybeSingle();
  if (error || !data) return { error: "Chưa lưu được chính sách. Hãy kiểm tra migration và quyền quản trị." };
  revalidatePath("/admin/settings"); revalidatePath("/admin/admins");
  return { success: "Đã lưu yêu cầu mật khẩu cho nhân viên được tạo mới." };
}
