"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getMerchantContext } from "../data";
import { requireExpectedStore } from "@/lib/active-store";
export async function markNoticeRead(form: FormData) {
  const { supabase, store } = await getMerchantContext();
  const notice = String(form.get("notice_id") ?? "");
  if (!store || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(notice)) redirect("/dashboard/notifications?message=failed");
  requireExpectedStore(form, store.id);
  const { error } = await supabase.rpc("mark_platform_notification_read", { requested_notice: notice, requested_store: store.id });
  if (error) redirect("/dashboard/notifications?message=failed");
  revalidatePath("/dashboard/notifications");
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/notifications");
}
