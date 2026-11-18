"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";

export async function sendNotification(form: FormData) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const title = String(form.get("title") ?? "").trim();
  const body = String(form.get("body") ?? "").trim();
  const category = String(form.get("category") ?? "");
  const audience = String(form.get("audience") ?? "");
  const store = String(form.get("store") ?? "");
  const plan = String(form.get("plan") ?? "");
  if (title.length < 3 || title.length > 160 || body.length < 1 || body.length > 4000 || !["general", "maintenance", "feature", "payment", "expiry"].includes(category) || !["all", "store", "plan"].includes(audience) || (audience === "store" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(store)) || (audience === "plan" && !["basic", "plus"].includes(plan))) redirect("/admin/notifications?message=invalid");
  const { error } = await supabase.rpc("admin_send_platform_notification", { notice_title: title, notice_body: body, notice_category: category, audience_kind: audience, store_target: audience === "store" ? store : null, plan_target: audience === "plan" ? plan : null });
  if (error) redirect(`/admin/notifications?message=${error.code === "P0002" ? "no-recipients" : error.message.includes("platform_notification_disabled") ? "disabled" : error.message.includes("notification_length_exceeded") ? "too-long" : "failed"}`);
  revalidatePath("/admin/notifications");
  revalidatePath("/dashboard/notifications");
  redirect("/admin/notifications?message=sent");
}
