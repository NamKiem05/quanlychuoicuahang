"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function assignStoreCategory(form: FormData) {
  const supabase = await createClient(); await requirePlatformAdminAccess(supabase);
  const storeId = String(form.get("store_id") ?? ""), categoryId = String(form.get("category_id") ?? "");
  if (!uuid.test(storeId)) redirect("/admin/stores");
  if (!uuid.test(categoryId)) redirect(`/admin/stores/${storeId}/edit?message=category-invalid`);
  const result = await supabase.rpc("admin_set_store_business_category", { target_store: storeId, target_category: categoryId });
  revalidatePath(`/admin/stores/${storeId}`); revalidatePath(`/admin/stores/${storeId}/edit`); revalidatePath("/dashboard", "layout");
  redirect(`/admin/stores/${storeId}/edit?message=${result.error ? "category-failed" : "category-updated"}`);
}
