import { createClient } from "@/lib/supabase/server";

export type PlatformSettings = { platform_name: string; description: string; contact_email: string; support_phone: string; default_language: string; default_timezone: string; logo_url: string | null; favicon_url: string | null };
export const defaultPlatformSettings: PlatformSettings = { platform_name: "GrowDesk", description: "Nền tảng tạo website và quản lý bán hàng cho cửa hàng.", contact_email: "", support_phone: "", default_language: "vi", default_timezone: "Asia/Ho_Chi_Minh", logo_url: null, favicon_url: null };
export async function getPlatformSettings() {
  try {
    const supabase = await createClient();
    const result = await supabase.from("platform_general_settings").select("platform_name, description, contact_email, support_phone, default_language, default_timezone, logo_url, favicon_url").eq("id", true).maybeSingle();
    return { settings: result.data as PlatformSettings | null, error: result.error };
  } catch { return { settings: null, error: true }; }
}
