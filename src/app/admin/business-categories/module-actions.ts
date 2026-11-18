"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function setCategoryModule(form: FormData) {
  const supabase = await createClient(); await requirePlatformAdminAccess(supabase);
  const category = String(form.get("category_id") ?? ""), moduleCode = String(form.get("module") ?? ""), enabled = String(form.get("enabled") ?? "");
  if (!uuid.test(category) || moduleCode !== "brands" || !["true", "false"].includes(enabled)) redirect("/admin/business-categories?message=invalid");
  const result = await supabase.rpc("admin_set_category_module", { target_category: category, target_module: moduleCode, next_enabled: enabled === "true" });
  revalidatePath("/admin/business-categories"); revalidatePath("/admin/stores", "layout"); revalidatePath("/dashboard", "layout");
  redirect(`/admin/business-categories?message=${result.error ? "module-failed" : "module-updated"}`);
}
