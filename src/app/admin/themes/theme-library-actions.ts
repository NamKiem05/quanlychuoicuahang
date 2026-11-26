"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { createClient } from "@/lib/supabase/server";
import { themeImageUrl } from "@/lib/theme-library";
import { defaultThemeManifest, themeFamilies, themeIdPattern } from "@/lib/theme-studio";

export async function saveLibraryTheme(_: string, form: FormData) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const theme = String(form.get("theme") ?? "");
  const source = String(form.get("source") ?? "");
  const revision = String(form.get("revision") ?? "");
  const title = String(form.get("title") ?? "").trim();
  const slug = String(form.get("slug") ?? "").trim();
  const summary = String(form.get("summary") ?? "").trim();
  const family = String(form.get("family") ?? "");
  const category = String(form.get("category") ?? "").trim();
  const image = String(form.get("image") ?? "").trim();
  const thumbnail = String(form.get("thumbnail") ?? "").trim();
  if ((theme && source) || (theme && !themeIdPattern.test(theme)) || (source && !themeIdPattern.test(source))
    || !/^\d{1,10}$/.test(revision) || Number(revision) > 2147483647
    || title.length < 2 || title.length > 100 || slug.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    || summary.length > 1000 || category.length > 80 || !Object.hasOwn(themeFamilies, family)
    || !themeImageUrl(image) || !themeImageUrl(thumbnail)) return "Kiểm tra tên, mã giao diện, ngành hàng và URL ảnh HTTPS.";

  const { data, error } = await supabase.rpc("admin_save_theme_library", {
    theme: theme || null, copy_from: source || null, expected_revision: Number(revision),
    title, slug, summary, family, theme_category: category, image_url: image || null, thumbnail: thumbnail || null,
    initial_config: theme || source ? null : defaultThemeManifest,
  });
  if (error?.code === "23505") return "Mã giao diện đã được sử dụng. Hãy chọn mã khác.";
  if (error?.code === "40001") return "Bản nháp vừa thay đổi. Hãy làm mới dữ liệu trước khi lưu lại.";
  if (error || typeof data !== "string" || !themeIdPattern.test(data)) return "Chưa lưu được giao diện. Hãy thử lại.";
  revalidatePath("/admin/themes", "layout");
  redirect(`/admin/themes?theme=${data}&message=${source ? "copied" : theme ? "saved" : "created"}`);
}

export async function changeLibraryTheme(_: string, form: FormData) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const theme = String(form.get("theme") ?? "");
  const revision = String(form.get("revision") ?? "");
  const visibility = String(form.get("visibility") ?? "");
  const command = String(form.get("command") ?? "");
  if (!themeIdPattern.test(theme) || !/^\d{1,10}$/.test(revision) || Number(revision) > 2147483647
    || !["true", "false"].includes(visibility) || !["archive", "hide", "show", "delete"].includes(command)
    || form.get("confirm") !== "yes") return "Thao tác hoặc dữ liệu xác nhận chưa hợp lệ.";
  const { error } = await supabase.rpc("admin_change_theme_library", {
    theme, expected_revision: Number(revision), expected_visibility: visibility === "true", command,
  });
  if (error?.code === "40001") return "Giao diện vừa thay đổi. Hãy làm mới dữ liệu và kiểm tra lại.";
  if (error?.code === "23503") return "Giao diện còn giấy phép, lượt cài hoặc đơn mua nên không thể xóa.";
  if (error?.code === "22023" && command === "delete") return "Chỉ bản nháp chưa từng phát hành mới có thể xóa.";
  if (error) return "Chưa cập nhật được giao diện. Hãy thử lại.";
  revalidatePath("/admin/themes", "layout");
  revalidatePath("/dashboard/themes");
  redirect(command === "delete" ? "/admin/themes?message=deleted" : `/admin/themes?theme=${theme}&message=${command}`);
}
