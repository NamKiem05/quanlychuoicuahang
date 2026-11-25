"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { readThemeManifest, themeFamilies, themeIdPattern } from "@/lib/theme-studio";
import { themeBlocks } from "@/lib/theme-pages";

function back(id = "", message = "failed", view = "studio"): never {
  redirect(`/admin/themes/${view === "pages" ? "pages" : "studio"}?${new URLSearchParams({ ...(id ? { edit: id } : {}), message })}`);
}

export async function autosaveThemeDraft(theme: string, revision: number, value: unknown) {
  const config = readThemeManifest(value);
  if (!themeIdPattern.test(theme) || !Number.isSafeInteger(revision) || revision < 0 || !config) return { error: "invalid" };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("admin_autosave_theme", { theme, expected_revision: revision, config });
    if (error || typeof data !== "number") return { error: error?.code === "40001" ? "conflict" : "unavailable" };
    return { revision: data };
  } catch {
    return { error: "unavailable" };
  }
}

export async function manageTheme(form: FormData) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const id = String(form.get("theme") ?? "");
  const revision = Number(form.get("revision"));
  const operation = form.get("operation");
  if ((id && !themeIdPattern.test(id)) || !Number.isSafeInteger(revision) || revision < 0) back();
  if (operation === "archive" && id) {
    if (form.get("confirm") !== "yes") back(id, "invalid");
    const { error } = await supabase.rpc("admin_archive_theme", { theme: id });
    if (error) back(id);
    revalidatePath("/dashboard/themes");
    back(id, "archived");
  }
  if (operation === "publish" && id) {
    const version = String(form.get("version") ?? "");
    if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version)) back(id, "invalid");
    const { error } = await supabase.rpc("admin_publish_theme", { theme: id, expected_revision: revision, release_version: version });
    if (error) back(id, error.code === "40001" ? "conflict" : "failed");
    revalidatePath("/dashboard/themes");
    back(id, "published");
  }
  if (operation !== "save") back(id, "invalid");
  const title = String(form.get("title") ?? "").trim();
  const slug = String(form.get("slug") ?? "").trim();
  const summary = String(form.get("summary") ?? "").trim();
  const family = String(form.get("family") ?? "");
  const compatibility = [...new Set(form.getAll("compatibility").map(String))].filter(item => item !== family);
  const rawPrice = String(form.get("price") ?? "");
  const image = String(form.get("image") ?? "").trim();
  let config;
  try {
    config = readThemeManifest(JSON.parse(String(form.get("manifest") ?? "")));
    if (image) {
      const url = new URL(image);
      if (url.protocol !== "https:" || url.username || url.password) back(id, "invalid");
    }
  } catch { back(id, "invalid"); }
  if (!config || title.length < 2 || title.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80
    || summary.length > 1000 || !Object.hasOwn(themeFamilies, family)
    || compatibility.some(item => !Object.hasOwn(themeFamilies, item)) || !/^\d{1,9}$/.test(rawPrice)
    || Number(rawPrice) > 100_000_000 || image.length > 2048) back(id, "invalid");
  const { data, error } = await supabase.rpc("admin_save_theme", {
    theme: id || null, expected_revision: revision, title, slug, summary, family, compatibility,
    price: Number(rawPrice), image_url: image || null, config,
  });
  if (error || !data) back(id, error?.code === "40001" ? "conflict" : "failed");
  back(data, "saved", String(form.get("view")));
}

export async function manageThemeLicense(form: FormData) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const purchase = String(form.get("purchase") ?? "");
  const finish = (message: string): never => redirect(`/admin/themes/licenses?message=${message}`);
  if (purchase) {
    const number = String(form.get("amount") ?? "");
    const reference = String(form.get("reference") ?? "").trim().toUpperCase();
    if (!themeIdPattern.test(purchase) || !/^[1-9]\d{0,8}$/.test(number) || !/^[A-Z0-9][A-Z0-9 ./_-]{2,119}$/.test(reference)) finish("invalid");
    const { error } = await supabase.rpc("admin_confirm_theme_transfer", { purchase, received: Number(number), reference });
    if (error) finish("failed");
  } else {
    const shop = String(form.get("store") ?? "");
    const theme = String(form.get("theme") ?? "");
    const reason = String(form.get("reason") ?? "").trim();
    if (!themeIdPattern.test(shop) || !themeIdPattern.test(theme) || reason.length < 5 || reason.length > 500) finish("invalid");
    const { error } = await supabase.rpc(form.get("command") === "grant" ? "admin_grant_free_theme" : "admin_revoke_theme_license", { shop, theme, reason });
    if (error) finish("failed");
  }
  revalidatePath("/dashboard/themes");
  finish("saved");
}

export async function updateThemeAdmin(form: FormData) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const command = form.get("command");
  const theme = String(form.get("theme") ?? "");
  const target = command === "policy" ? "/admin/themes/settings" :
    command === "components" ? "/admin/themes/components" : form.get("view") === "marketplace" ? "/admin/themes/marketplace" : "/admin/themes";
  let failed = true;
  if (command === "policy" || command === "components") {
    const blocked = [...new Set(form.getAll("disabled").map(String))];
    const rawLimit = form.get("max_custom_pages");
    const customPages = command === "components" ? null : rawLimit ? Number(rawLimit) : NaN;
    const open = command === "components" ? null : form.has("marketplace_open");
    if ((customPages === null || (Number.isInteger(customPages) && customPages >= 0 && customPages <= 16))
      && blocked.every(component => Object.hasOwn(themeBlocks, component))) {
      const { error } = await supabase.rpc("admin_update_theme_policy", { open_marketplace: open, custom_pages: customPages, blocked });
      failed = Boolean(error);
    }
  } else if (themeIdPattern.test(theme)) {
    if (command === "hide" || command === "show") {
      const { error } = await supabase.rpc("admin_theme_visibility", { theme, visible: command === "show" });
      failed = Boolean(error);
    } else if (command === "delete" && form.get("confirm") === "yes") {
      const { error } = await supabase.rpc("admin_delete_unreleased_theme", { theme });
      failed = Boolean(error);
    }
  }
  revalidatePath("/admin/themes", "layout");
  revalidatePath("/dashboard/themes");
  redirect(`${target}?message=${failed ? "failed" : "saved"}`);
}

export async function restoreThemeDraft(form: FormData) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const theme = String(form.get("theme") ?? "");
  const release = String(form.get("release") ?? "");
  const expected_revision = Number(form.get("revision"));
  if (!themeIdPattern.test(theme) || !themeIdPattern.test(release) || !Number.isSafeInteger(expected_revision) || expected_revision < 0 || form.get("confirm") !== "yes") back("", "invalid");
  const { error } = await supabase.rpc("admin_restore_theme_version", { theme, release, expected_revision });
  if (error) back(theme, error.code === "40001" ? "conflict" : "failed");
  revalidatePath("/admin/themes", "layout");
  back(theme, "saved");
}

export async function setThemeSupportPriority(form: FormData) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const ticket = String(form.get("ticket") ?? "");
  const level = String(form.get("level") ?? "");
  if (!themeIdPattern.test(ticket) || !["low","normal","high"].includes(level)) redirect("/admin/themes/support?message=failed");
  const { error } = await supabase.rpc("admin_theme_ticket_priority", { ticket, level });
  revalidatePath("/admin/themes/support");
  redirect(`/admin/themes/support?message=${error ? "failed" : "saved"}`);
}
