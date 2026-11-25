import { redirect } from "next/navigation";
import type { createClient } from "@/lib/supabase/server";

type PlatformClient = Awaited<ReturnType<typeof createClient>>;

export async function liveSessionStatus(client: PlatformClient) {
  const { data, error } = await client.rpc("growdesk_session_status", { record_activity: false });
  if (error?.code === "PT401" || data?.status === "expired") return "expired";
  return !error && data?.status === "active" ? "active" : "unavailable";
}

async function requireLiveSession(client: PlatformClient) {
  const { data: auth } = await client.auth.getClaims();
  if (!auth?.claims?.sub) redirect("/login");
  const status = await liveSessionStatus(client);
  if (status === "expired") redirect("/login?message=session-expired");
  if (status !== "active") throw new Error("Chưa thể xác minh phiên làm việc.");
  return auth.claims.sub;
}

export async function requirePlatformAdminAccess(client: PlatformClient) {
  const userId = await requireLiveSession(client);
  const { data } = await client.rpc("is_platform_admin");
  if (data !== true) {
    const support = await client.rpc("has_support_ticket_permission");
    redirect(support.data === true && !support.error ? "/admin/tickets" : "/admin");
  }
  return userId;
}

export async function requireSupportTicketAccess(client: PlatformClient) {
  const userId = await requireLiveSession(client);
  const { data, error } = await client.rpc("has_support_ticket_permission");
  if (error?.code === "PGRST202") {
    const legacy = await client.rpc("is_platform_admin");
    if (!legacy.error && legacy.data === true) return userId;
  }
  if (error || data !== true) redirect("/admin");
  return userId;
}

export async function requireMerchantAccount(client: PlatformClient) {
  await requireLiveSession(client);
  const { data, error } = await client.rpc("platform_account_access");
  if (error) throw new Error("Không xác minh được loại tài khoản.");
  if (data === "admin" || data === "admin_inactive") redirect("/admin");
  if (data === "merchant") return;
  throw new Error("Không xác minh được loại tài khoản.");
}
