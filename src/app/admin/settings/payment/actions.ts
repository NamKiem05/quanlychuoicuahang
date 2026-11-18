"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { getMerchantPlanWebhookSecret, getPlatformBankAccount } from "@/lib/merchant-billing";

type Result = { success?: string; error?: string } | null;
export async function savePaymentSettings(_previous: Result, form: FormData): Promise<Result> {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const enabled = form.get("sepay_enabled") === "on";
  if (enabled && (!getPlatformBankAccount() || !getMerchantPlanWebhookSecret())) return { error: "Cần cấu hình tài khoản ngân hàng và khóa webhook trên máy chủ trước khi bật." };
  const { data, error } = await supabase.from("platform_payment_settings").update({ sepay_enabled: enabled, updated_at: new Date().toISOString() }).eq("id", true).select("id").maybeSingle();
  if (error || !data) return { error: "Chưa lưu được cấu hình thanh toán. Kiểm tra migration và quyền quản trị." };
  revalidatePath("/admin/settings"); revalidatePath("/merchant-plan");
  return { success: enabled ? "Đã bật tạo yêu cầu thanh toán mới." : "Đã tắt tạo yêu cầu thanh toán mới. Các giao dịch đang chờ vẫn được đối soát." };
}
export async function checkPaymentConfiguration(_previous: Result): Promise<Result> {
  void _previous;
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const { data, error } = await supabase.from("platform_payment_settings").select("sepay_enabled").eq("id", true).maybeSingle();
  if (error || !data) return { error: "Không đọc được cấu hình thanh toán. Kiểm tra cơ sở dữ liệu và migration." };
  if (!getPlatformBankAccount() || !getMerchantPlanWebhookSecret()) return { error: "Thiếu hoặc không hợp lệ thông tin ngân hàng, khóa webhook SePay hoặc service role trên máy chủ." };
  return { success: `Cấu hình ngân hàng, khóa webhook và cơ sở dữ liệu đã sẵn sàng. ${data.sepay_enabled ? "Tạo thanh toán mới đang bật." : "Tạo thanh toán mới đang tắt."} Chưa xác minh kết nối thực tế tới SePay.` };
}
