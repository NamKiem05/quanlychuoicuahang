"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { isStorefrontStyle } from "@/lib/store-appearance";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function saveTemplate(formData: FormData) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const base_style = String(formData.get("base_style") ?? "");
  const required_plan = String(formData.get("required_plan") ?? "");
  const preview = String(formData.get("preview_url") ?? "").trim();
  let validPreview = !preview;
  try { if (preview) { const url = new URL(preview); validPreview = url.protocol === "https:" && !url.username && !url.password; } } catch { validPreview = false; }
  if ((id && !uuid.test(id)) || name.length < 2 || name.length > 100 || description.length > 1000 || category.length > 80 || !isStorefrontStyle(base_style) || !["basic", "plus"].includes(required_plan) || preview.length > 2048 || !validPreview) redirect("/admin/themes?message=invalid");
  const fields = { name, description, category, base_style, required_plan, preview_url: preview || null, is_enabled: formData.has("is_enabled"), is_featured: formData.has("is_featured"), updated_at: new Date().toISOString() };
  const result = id ? await supabase.from("storefront_template_catalog").update(fields).eq("id", id).select("id").maybeSingle() : await supabase.from("storefront_template_catalog").insert(fields).select("id").maybeSingle();
  if (result.error || !result.data) redirect("/admin/themes?message=failed");
  revalidatePath("/admin/themes");
  redirect("/admin/themes?message=saved");
}

export async function deleteTemplate(formData: FormData) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const id = String(formData.get("id") ?? "");
  if (!uuid.test(id) || formData.get("confirm_delete") !== "yes") redirect("/admin/themes?message=invalid");
  const result = await supabase.from("storefront_template_catalog").delete().eq("id", id).select("id").maybeSingle();
  if (result.error || !result.data) redirect("/admin/themes?message=failed");
  revalidatePath("/admin/themes");
  redirect("/admin/themes?message=deleted");
}
