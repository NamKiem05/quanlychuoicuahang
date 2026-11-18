"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
export async function setStoreModule(form: FormData) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const storeId = String(form.get("store_id") ?? "");
  const moduleCode = String(form.get("module") ?? "");
  const value = String(form.get("enabled") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storeId) || moduleCode !== "brands" || !["true", "false"].includes(value)) redirect("/admin/stores");
  const result = await supabase.rpc("admin_set_store_module", { target_store: storeId, target_module: moduleCode, next_enabled: value === "true" });
  revalidatePath(`/admin/stores/${storeId}`); revalidatePath("/dashboard", "layout");
  redirect(`/admin/stores/${storeId}?message=${result.error ? "module-failed" : "module-updated"}`);
}
export async function resetStoreModule(form: FormData) {
  const supabase = await createClient(); await requirePlatformAdminAccess(supabase);
  const storeId = String(form.get("store_id") ?? ""), moduleCode = String(form.get("module") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storeId) || moduleCode !== "brands") redirect("/admin/stores");
  const result = await supabase.rpc("admin_reset_store_module", { target_store: storeId, target_module: moduleCode });
  revalidatePath(`/admin/stores/${storeId}`); revalidatePath("/dashboard", "layout");
  redirect(`/admin/stores/${storeId}?message=${result.error ? "module-failed" : "module-updated"}`);
}
