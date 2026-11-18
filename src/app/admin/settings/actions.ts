"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";

type Result = { error?: string; success?: string } | null;
async function uploadAsset(supabase: Awaited<ReturnType<typeof createClient>>, file: File, kind: "logo" | "favicon") {
  if (file.size > 2 * 1024 * 1024) throw new Error("Ảnh cần có dung lượng tối đa 2 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const png = bytes.length > 8 && [137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v);
  const jpg = bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  const ico = bytes.length > 6 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0;
  const type = png ? ["png", "image/png"] : jpg ? ["jpg", "image/jpeg"] : webp ? ["webp", "image/webp"] : ico && kind === "favicon" ? ["ico", "image/x-icon"] : null;
  if (!type) throw new Error(kind === "logo" ? "Logo phải là ảnh PNG, JPG hoặc WebP hợp lệ." : "Favicon phải là ảnh PNG, JPG, WebP hoặc ICO hợp lệ.");
  const path = `${kind}/${randomUUID()}.${type[0]}`;
  const { error } = await supabase.storage.from("platform-assets").upload(path, bytes, { contentType: type[1], upsert: false });
  if (error) throw new Error("Không tải được ảnh. Hãy kiểm tra bucket platform-assets và quyền quản trị.");
  return supabase.storage.from("platform-assets").getPublicUrl(path).data.publicUrl;
}
export async function saveGeneralSettings(_previous: Result, form: FormData): Promise<Result> {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const name = String(form.get("platform_name") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const email = String(form.get("contact_email") ?? "").trim();
  const phone = String(form.get("support_phone") ?? "").trim();
  if (!name || name.length > 100 || description.length > 1000 || phone.length > 30 || email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return { error: "Hãy kiểm tra tên, email và độ dài các thông tin đã nhập." };
  if (form.get("default_language") !== "vi" || form.get("default_timezone") !== "Asia/Ho_Chi_Minh") return { error: "Ngôn ngữ hoặc múi giờ chưa được hỗ trợ." };
  const fields: Record<string, string | null> = { platform_name: name, description, contact_email: email, support_phone: phone, default_language: "vi", default_timezone: "Asia/Ho_Chi_Minh", updated_at: new Date().toISOString() };
  try {
    for (const kind of ["logo", "favicon"] as const) {
      const file = form.get(kind);
      if (file instanceof File && file.size) fields[`${kind}_url`] = await uploadAsset(supabase, file, kind);
      else if (form.get(`remove_${kind}`) === "on") fields[`${kind}_url`] = null;
    }
  } catch (error) { return { error: error instanceof Error ? error.message : "Không tải được ảnh." }; }
  const { data, error } = await supabase.from("platform_general_settings").update(fields).eq("id", true).select("id").maybeSingle();
  if (error || !data) return { error: "Chưa lưu được cấu hình. Hãy kiểm tra migration và quyền quản trị." };
  revalidatePath("/", "layout");
  revalidatePath("/admin/settings");
  return { success: "Đã lưu cấu hình chung." };
}
