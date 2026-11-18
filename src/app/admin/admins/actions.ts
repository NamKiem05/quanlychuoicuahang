"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdminAccess } from "@/lib/platform-account";

function adminsRedirect(message: string) {
  return "/admin/admins?message=" + encodeURIComponent(message);
}
function rolesRedirect(message: string) { return "/admin/roles?message=" + encodeURIComponent(message); }

async function requirePlatformAdmin() {
  const supabase = await createClient();
  const userId = await requirePlatformAdminAccess(supabase);
  return { userId, supabase, adminClient: createAdminClient() };
}

async function getProvisioningAdmin() {
  const { supabase, adminClient } = await requirePlatformAdmin();
  const { data: access } = await supabase.rpc("platform_account_access");
  if (access !== "admin") redirect(adminsRedirect("admin-separation-required"));
  return { supabase, adminClient };
}

function readAdminEmail(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLocaleLowerCase("en-US");
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

function refreshAdminLists() {
  revalidatePath("/admin/admins");
  revalidatePath("/admin/accounts");
  revalidatePath("/admin/roles");
  revalidatePath("/admin");
}

export async function grantPlatformAdmin(formData: FormData) {
  const { adminClient } = await getProvisioningAdmin();
  const email = readAdminEmail(formData);
  if (!email) redirect(rolesRedirect("admin-invalid-email"));
  let matchedUser: { id: string; app_metadata: Record<string, unknown> } | null = null;
  let page = 1;
  while (!matchedUser) {
    const result = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) redirect(rolesRedirect("admin-list-failed"));
    matchedUser = result.data.users.find((user) => user.email?.toLocaleLowerCase("en-US") === email) ?? null;
    if (matchedUser || !result.data.nextPage || result.data.nextPage <= page) break;
    page = result.data.nextPage;
  }
  if (!matchedUser) redirect(rolesRedirect("admin-user-not-found"));
  if (matchedUser.app_metadata.account_kind !== "platform_admin") redirect(rolesRedirect("admin-merchant-account-invalid"));
  const { error } = await adminClient.from("platform_admins").insert({ user_id: matchedUser.id });
  if (error?.code === "23505") redirect(rolesRedirect("admin-already-admin"));
  if (error?.message?.includes("scoped_role_must_be_removed")) redirect(rolesRedirect("remove-scoped-first"));
  if (error?.message === "dedicated_admin_account_required") redirect(rolesRedirect("admin-merchant-account-invalid"));
  if (error) redirect(rolesRedirect("admin-grant-failed"));
  refreshAdminLists();
  redirect(rolesRedirect("admin-granted"));
}

export async function setSupportStaffRole(formData: FormData) {
  const { supabase, adminClient } = await requirePlatformAdmin();
  const email = readAdminEmail(formData);
  const operation = String(formData.get("operation") ?? "");
  if (!email || !["grant", "revoke"].includes(operation)) redirect(rolesRedirect("admin-invalid-email"));
  let targetId: string | null = null;
  let page = 1;
  for (;;) {
    const result = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) redirect(rolesRedirect("admin-list-failed"));
    const user = result.data.users.find((item) => item.email?.toLocaleLowerCase("en-US") === email);
    if (user) {
      if (user.app_metadata?.account_kind !== "platform_admin") redirect(rolesRedirect("admin-merchant-account-invalid"));
      targetId = user.id;
      break;
    }
    if (!result.data.nextPage || result.data.nextPage <= page) break;
    page = result.data.nextPage;
  }
  if (!targetId) redirect(rolesRedirect("admin-user-not-found"));
  const result = await supabase.rpc("assign_support_staff_role", { target_user: targetId, enable_role: operation === "grant" });
  if (result.error) redirect(rolesRedirect(result.error.message.includes("account has full admin access") ? "full-admin-first" : "scoped-failed"));
  refreshAdminLists();
  revalidatePath(`/admin/admins/${targetId}`);
  redirect(rolesRedirect(operation === "grant" ? "support-granted" : "support-revoked"));
}

export async function revokePlatformAdmin(formData: FormData) {
  const { userId: actorId, adminClient } = await requirePlatformAdmin();
  const targetId = String(formData.get("user_id") ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetId)) {
    redirect(adminsRedirect("admin-invalid-target"));
  }
  if (targetId === actorId) redirect(adminsRedirect("admin-self-protected"));

  const { data: administrators, error: listError } = await adminClient.from("platform_admins").select("user_id");
  if (listError) redirect(adminsRedirect("admin-revoke-failed"));
  if (!(administrators ?? []).some((administrator) => administrator.user_id === targetId)) {
    redirect(adminsRedirect("admin-not-found"));
  }
  if ((administrators ?? []).length <= 1) redirect(adminsRedirect("admin-last-protected"));

  const { data: removedAdmin, error } = await adminClient
    .from("platform_admins")
    .delete()
    .eq("user_id", targetId)
    .select("user_id")
    .maybeSingle();
  if (error || !removedAdmin) redirect(adminsRedirect("admin-revoke-failed"));

  revalidatePath("/admin/admins");
  revalidatePath("/admin/accounts");
  revalidatePath("/admin");
  redirect(adminsRedirect("admin-revoked"));
}

export async function updatePlatformAdminProfile(formData: FormData) {
  const { adminClient } = await requirePlatformAdmin();
  const targetId = String(formData.get("user_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetId)) redirect(adminsRedirect("admin-invalid-target"));
  if (name.length < 2 || name.length > 120 || phone.length > 30) redirect(`/admin/admins/${targetId}?message=invalid`);
  const { data: user, error: userError } = await adminClient.auth.admin.getUserById(targetId);
  if (userError || !user.user || user.user.app_metadata?.account_kind !== "platform_admin") redirect(`/admin/admins/${targetId}?message=failed`);
  const { error } = await adminClient.from("profiles").upsert({ id: targetId, display_name: name, phone: phone || null });
  if (error) redirect(`/admin/admins/${targetId}?message=failed`);
  refreshAdminLists();
  revalidatePath(`/admin/admins/${targetId}`);
  redirect(`/admin/admins/${targetId}?message=updated`);
}
