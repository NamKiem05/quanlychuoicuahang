import type { SupabaseClient } from "@supabase/supabase-js";

export function loginDestination(params: { get(name: string): string | null }) {
  const store = params.get("store") ?? "";
  if (store.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(store)) {
    return { store, path: `/${store}?checkout=1` };
  }
  const next = params.get("next");
  if (next === "customer-orders") return { next, path: "/customer/orders" };
  if (next === "customer-account") return { next, path: "/customer/account" };
  if (next === "staff-invitations") return { next };
  return {};
}

export async function resolveLoginDestination(
  supabase: SupabaseClient,
  userId: string,
  destination: ReturnType<typeof loginDestination>,
  { supportWorkspace = false } = {},
) {
  if (destination.path) return destination.path;
  const { data: access, error } = await supabase.rpc("platform_account_access");
  if (error) return null;
  if (access === "admin_inactive" && supportWorkspace) {
    const support = await supabase.rpc("has_support_ticket_permission");
    if (support.error) return null;
    return support.data === true ? "/admin/tickets" : "/admin";
  }
  if (access === "admin" || access === "admin_inactive") return "/admin";
  if (access !== "merchant") return null;
  if (destination.next === "staff-invitations") return "/staff-invitations";
  const membership = await supabase.from("store_members").select("store_id").eq("user_id", userId).limit(2);
  if (membership.error) return null;
  return (membership.data?.length ?? 0) > 1 ? "/select-store" : "/dashboard";
}
