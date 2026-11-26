"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { createClient } from "@/lib/supabase/server";
import { themeCreationMethods, validCreationSlug, type ThemeCreationSource } from "@/lib/theme-creation";
import { themeImageUrl } from "@/lib/theme-library";
import { themeIdPattern } from "@/lib/theme-studio";

export async function checkThemeCreationSlug(slug: string) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  if (typeof slug !== "string" || !validCreationSlug(slug)) return "Mã giao diện chưa hợp lệ.";
  const { data, error } = await supabase.from("storefront_template_catalog").select("id").eq("theme_slug",slug).maybeSingle();
  return error ? "Chưa kiểm tra được mã giao diện." : data ? "Mã giao diện đã tồn tại. Hãy đổi sang mã khác." : "";
}

export async function findThemeCreationSources(method: string, term: string, page: number) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  if ((method !== "starter" && method !== "clone") || typeof term !== "string" || !Number.isInteger(page) || page<1 || page>8000) return null;
  const { data, error } = await supabase.rpc("admin_list_theme_creation_sources", { method, term: term.trim().slice(0,100), page_offset: (page-1)*12 });
  return error ? null : data as { count: number; rows: ThemeCreationSource[] };
}

export async function createThemeFromWizard(_: string, form: FormData) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const text = (key: string) => String(form.get(key) ?? "").trim();
  const title = text("title"), slug = text("slug"), summary = text("summary"), category = text("category");
  const method = text("method"), source = text("source"), revision = text("revision"), version = text("version");
  const thumbnail = text("thumbnail"), image = text("image");
  if (title.length<2 || title.length>100 || !validCreationSlug(slug) || summary.length>1000
    || !themeIdPattern.test(category) || !Object.hasOwn(themeCreationMethods,method) || !themeImageUrl(thumbnail) || !themeImageUrl(image)
    || (method!=="blank" && !themeIdPattern.test(source))
    || (method==="clone" && (!/^\d{1,10}$/.test(revision) || Number(revision)>2147483647))
    || (method==="starter" && !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version))) return "Kiểm tra thông tin giao diện và nguồn khởi tạo.";
  let response;
  try {
    response = await supabase.rpc("admin_create_theme_from_source", {
      title, slug, summary, category_id: category, method, source_theme: method==="blank" ? null : source,
      source_revision: method==="clone" ? Number(revision) : null, source_version: method==="starter" ? version : null,
      image_url: image || null, thumbnail: thumbnail || null,
    });
  } catch {
    return "Mất kết nối khi tạo. Hãy kiểm tra Kho theo slug trước khi thử lại.";
  }
  const { data, error } = response;
  if (error || typeof data !== "string" || !themeIdPattern.test(data)) {
    if (error?.code==="23505") return "Mã giao diện đã tồn tại. Hãy quay lại đổi slug hoặc kiểm tra Kho nếu vừa thử lại.";
    if (error?.code==="PT404") return "Danh mục đã thay đổi. Hãy tải lại và chọn danh mục hiện có.";
    if (error?.code==="PT410" || error?.code==="40001") return "Nguồn đã thay đổi hoặc không còn khả dụng. Hãy quay lại chọn lại nguồn.";
    if (error?.code==="PT422" || error?.code==="PT409") return "Nguồn không tương thích ngành hàng, giới hạn trang hoặc chính sách component hiện tại.";
    if (error?.code==="PT423") return "Nguồn tham chiếu ảnh thiết kế đã thiếu trong Storage.";
    if (error?.code==="42501") return "Phiên hiện tại không có quyền tạo giao diện.";
    console.error("Theme creation failed", { code: error?.code ?? "unexpected_result" });
    return "Chưa xác nhận được kết quả tạo. Hãy kiểm tra Kho theo slug trước khi thử lại.";
  }
  revalidatePath("/admin/themes","layout");
  redirect(`/admin/themes?theme=${data}&message=${method==="clone" ? "copied" : "created"}`);
}
