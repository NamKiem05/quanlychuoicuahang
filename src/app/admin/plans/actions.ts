"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";

const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function integer(value: FormDataEntryValue | null, max: number, optional = false) {
  const text = String(value ?? "").trim();
  if (!text && optional) return null;
  if (!/^\d+$/.test(text)) return NaN;
  const number = Number(text);
  return Number.isSafeInteger(number) && number <= max ? number : NaN;
}

export async function savePlanDraft(formData: FormData) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const id = String(formData.get("id") ?? "");
  if (id && !validId.test(id)) redirect("/admin/plans?message=invalid");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const price = integer(formData.get("price_vnd"), 2147483647);
  const billing = integer(formData.get("billing_months"), 36);
  const trial = integer(formData.get("trial_days"), 365);
  const limits = Object.fromEntries(["product_limit", "order_limit", "staff_limit", "storage_mb", "website_limit"].map((key) => [key, integer(formData.get(key), 10000000, true)]));
  if (name.length < 2 || name.length > 100 || description.length > 1000 || price === null || billing === null || billing < 1 || trial === null || [price, billing, trial, ...Object.values(limits)].some((value) => value !== null && Number.isNaN(value))) redirect("/admin/plans?message=invalid");
  const data = { name, description, price_vnd: price, billing_months: billing, trial_days: trial, ...limits, features: { promotions: formData.has("feature_promotions"), custom_domains: formData.has("feature_domains"), appearance: formData.has("feature_appearance") }, updated_at: new Date().toISOString() };
  const result = id ? await supabase.from("service_plan_drafts").update(data).eq("id", id).select("id").maybeSingle() : await supabase.from("service_plan_drafts").insert(data).select("id").maybeSingle();
  if (result.error || !result.data) redirect("/admin/plans?message=failed");
  revalidatePath("/admin/plans");
  redirect("/admin/plans?message=saved");
}

export async function changePlanDraft(formData: FormData) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const id = String(formData.get("id") ?? "");
  const operation = String(formData.get("operation") ?? "");
  if (!validId.test(id) || !["retire", "restore", "delete"].includes(operation)) redirect("/admin/plans?message=invalid");
  if (operation === "delete" && formData.get("confirm_delete") !== "yes") redirect("/admin/plans?message=invalid");
  const result = operation === "delete" ? await supabase.from("service_plan_drafts").delete().eq("id", id).select("id").maybeSingle() : await supabase.from("service_plan_drafts").update({ status: operation === "retire" ? "retired" : "draft", updated_at: new Date().toISOString() }).eq("id", id).select("id").maybeSingle();
  if (result.error || !result.data) redirect("/admin/plans?message=failed");
  revalidatePath("/admin/plans");
  redirect("/admin/plans?message=changed");
}
