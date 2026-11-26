"use server";

import { randomUUID } from "node:crypto";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { createClient } from "@/lib/supabase/server";
import { themeIdPattern } from "@/lib/theme-studio";
import { maxThemeImageBytes, themeStudioImageType } from "@/lib/theme-studio-image";

export async function uploadStudioImage(theme: string, form: FormData) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  if (!themeIdPattern.test(theme)) return { error: "Mã giao diện không hợp lệ." };
  const file = form.get("image");
  if (!(file instanceof File) || !file.size || file.size > maxThemeImageBytes) return { error: "Chọn ảnh có dung lượng tối đa 2 MB." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = themeStudioImageType(bytes);
  if (!type || (file.type && file.type !== type.mime)) return { error: "Chỉ hỗ trợ ảnh PNG, JPEG hoặc WebP hợp lệ." };
  const { data } = await supabase.from("storefront_template_catalog").select("id").eq("id", theme).maybeSingle();
  if (!data) return { error: "Chưa tìm thấy giao diện." };
  const key = `theme-studio/${theme.toLowerCase()}/${randomUUID()}.${type.extension}`;
  const { error } = await supabase.storage.from("platform-assets").upload(key, bytes, { contentType: type.mime, upsert: false });
  return error ? { error: "Chưa tải được ảnh. Kiểm tra kết nối và quyền Storage." } : { key };
}
