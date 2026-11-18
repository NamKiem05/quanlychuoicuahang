import { redirect } from "next/navigation";
import type { createClient } from "@/lib/supabase/server";

type PlatformClient = Awaited<ReturnType<typeof createClient>>;

export async function requirePlatformAdminAccess(client: PlatformClient) {
  const { data: auth } = await client.auth.getClaims();
  if (!auth?.claims?.sub) redirect("/login");
  const { data } = await client.rpc("is_platform_admin");
  if (data !== true) {
    const support = await client.rpc("has_support_ticket_permission");
    redirect(support.data === true && !support.error ? "/admin/tickets" : "/admin");
  }
  return auth.claims.sub;
}

export async function requireSupportTicketAccess(client: PlatformClient) {
  const { data: auth } = await client.auth.getClaims();
  if (!auth?.claims?.sub) redirect("/login");
  const { data, error } = await client.rpc("has_support_ticket_permission");
  if (error?.code === "PGRST202") {
    const legacy = await client.rpc("is_platform_admin");
    if (!legacy.error && legacy.data === true) return auth.claims.sub;
  }
  if (error || data !== true) redirect("/admin");
  return auth.claims.sub;
}

export async function requireMerchantAccount(client: PlatformClient) {
  const { data, error } = await client.rpc("platform_account_access");
  if (data === "admin" || data === "admin_inactive") redirect("/admin");
  if (data === "merchant") return;

  // Keep the existing administrator routing while the migration is being applied.
  if (error?.code === "PGRST202") {
    const { data: isAdmin, error: adminError } = await client.rpc("is_platform_admin");
    if (isAdmin) redirect("/admin");
    if (!adminError) return;
  }
  throw new Error("Không xác minh được loại tài khoản.");
}
