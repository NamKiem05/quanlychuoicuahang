"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { isMerchandiseMode } from "@/lib/merchandise-mode";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function slugify(name: string) {
  return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function saveBusinessCategory(formData: FormData) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const slug = slugify(name);
  const mode = formData.get("merchandise_mode");
  if (!isMerchandiseMode(mode)) redirect("/admin/business-categories?message=invalid");
  if ((id && !uuid.test(id)) || name.length < 2 || name.length > 100 || description.length > 500 || !slug || slug.length > 100) redirect("/admin/business-categories?message=invalid");
  const fields = { name, slug, description, merchandise_mode: mode, updated_at: new Date().toISOString() };
  const result = id ? await supabase.from("business_categories").update(fields).eq("id", id).select("id").maybeSingle() : await supabase.from("business_categories").insert(fields).select("id").maybeSingle();
  if (result.error?.code === "23505") redirect("/admin/business-categories?message=duplicate");
  if (result.error || !result.data) redirect("/admin/business-categories?message=failed");
  revalidatePath("/admin/business-categories");
  revalidatePath("/dashboard", "layout");
  redirect(`/admin/business-categories?message=${id ? "updated" : "created"}`);
}

export async function deleteBusinessCategory(formData: FormData) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const id = String(formData.get("id") ?? "");
  if (!uuid.test(id) || formData.get("confirm_delete") !== "yes") redirect("/admin/business-categories?message=invalid");
  const result = await supabase.from("business_categories").delete().eq("id", id).select("id").maybeSingle();
  if (result.error?.code === "23503") redirect("/admin/business-categories?message=used");
  if (result.error || !result.data) redirect("/admin/business-categories?message=failed");
  revalidatePath("/admin/business-categories");
  redirect("/admin/business-categories?message=deleted");
}
