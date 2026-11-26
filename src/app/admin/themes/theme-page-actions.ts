"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { createClient } from "@/lib/supabase/server";
import { changeThemePages, type PageCommand } from "@/lib/theme-page-management";
import { contentPageTemplates, themePageKinds, type ContentPageTemplate, type PageKind } from "@/lib/theme-pages";
import { readThemeManifest, themeIdPattern } from "@/lib/theme-studio";

export async function manageThemePage(_: string, form: FormData) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const read = (key: string) => String(form.get(key) ?? "").trim();
  const theme = read("theme");
  const id = read("page");
  const revision = read("revision");
  const operation = read("operation");
  if (!themeIdPattern.test(theme) || (operation !== "create" && !themeIdPattern.test(id))
    || !/^\d{1,10}$/.test(revision) || Number(revision) > 2147483647) return "Giao diện, trang hoặc revision không hợp lệ.";
  let command: PageCommand;
  if (operation === "create" || operation === "edit") {
    const kind = read("kind") as PageKind;
    const template = read("template") as ContentPageTemplate;
    if (!Object.hasOwn(themePageKinds, kind) || (kind === "custom" && !Object.hasOwn(contentPageTemplates, template))) return "Loại trang hoặc template không hợp lệ.";
    command = { type: operation, id, fields: {
      kind, title: read("title"), slug: kind === "custom" ? read("slug") : kind, description: read("description"),
      visible: kind !== "custom" || read("visible") === "yes",
      meta: {
        ...(kind === "custom" ? { template } : {}),
        navigation: read("navigation") === "yes", seoTitle: read("seoTitle"), seoDescription: read("seoDescription"),
        ogTitle: read("ogTitle"), ogDescription: read("ogDescription"), ...(read("ogImage") ? { ogImage: read("ogImage") } : {}),
        noindex: read("noindex") === "yes",
      },
    } };
  } else if (operation === "copy" || operation === "delete" || operation === "home" || operation === "toggle" || operation === "up" || operation === "down") {
    if ((operation === "delete" || operation === "home") && read("confirm") !== "yes") return "Cần xác nhận thao tác.";
    command = { type: operation, id };
  } else return "Thao tác trang không hợp lệ.";
  const [lookup, policy] = await Promise.all([
    supabase.from("storefront_template_catalog").select("draft,draft_revision,primary_family").eq("id", theme).maybeSingle(),
    supabase.from("storefront_theme_policy").select("disabled_components,deprecated_components,max_custom_pages").maybeSingle(),
  ]);
  if (lookup.error || !lookup.data || policy.error || !policy.data) return "Chưa tải được giao diện hoặc chính sách component.";
  if (lookup.data.draft_revision !== Number(revision)) return "Bản nháp vừa thay đổi. Hãy làm mới trước khi lưu.";
  const manifest = readThemeManifest(lookup.data.draft);
  if (!manifest) return "Bản nháp hiện tại không hợp lệ.";
  const result = changeThemePages(manifest.pages ?? [], command, {
    now: new Date().toISOString(), id: randomUUID, family: lookup.data.primary_family,
    disabled: [...policy.data.disabled_components, ...policy.data.deprecated_components], maxCustomPages: policy.data.max_custom_pages,
  });
  if ("error" in result) return result.error;
  const { error } = await supabase.rpc("admin_autosave_theme", {
    theme, expected_revision: Number(revision), config: { ...manifest, schemaVersion: 2, pages: result.pages },
  });
  if (error) return error.code === "40001" ? "Bản nháp vừa thay đổi. Hãy làm mới trước khi lưu." :
    error.code === "PT409" ? "Trang có component đang ngừng thêm mới. Gỡ component đó trước khi nhân bản." : "Chưa lưu được thay đổi của trang.";
  revalidatePath("/admin/themes", "layout");
  const query = new URLSearchParams({ edit: theme, message: operation });
  if (result.selected) query.set("page", result.selected);
  redirect(`/admin/themes/pages?${query}`);
}
