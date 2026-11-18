import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { createClient } from "@/lib/supabase/server";

export const activeStoreCookie = "kingweb_active_store";
export function requireExpectedStore(form: FormData, storeId: string) {
  if (form.get("__active_store_id") !== storeId) redirect("/dashboard?message=store-changed");
}
export async function getActiveMembership(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const selected = (await cookies()).get(activeStoreCookie)?.value;
  if (selected && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selected)) {
    const result = await supabase.from("store_members").select("store_id, role").eq("user_id", userId).eq("store_id", selected).maybeSingle();
    if (result.error) throw new Error("Không xác minh được quyền cửa hàng.");
    if (result.data) return result.data;
  }
  const result = await supabase.from("store_members").select("store_id, role").eq("user_id", userId).order("created_at").order("store_id").limit(2);
  if (result.error) throw new Error("Không tải được danh sách cửa hàng.");
  if (result.data.length > 1) redirect("/select-store");
  return result.data[0] ?? null;
}
