"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

function adminsRedirect(message: string) {
  return "/admin/admins?message=" + encodeURIComponent(message);
}

async function requirePlatformAdmin() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  if (!authData?.claims?.sub) redirect("/login");
  const { data: isAdmin, error } = await supabase.rpc("is_platform_admin");
  if (error || !isAdmin) redirect("/admin?message=not-admin");
  return { userId: authData.claims.sub, adminClient: createAdminClient() };
}

export async function grantPlatformAdmin(formData: FormData) {
  const { adminClient } = await requirePlatformAdmin();
  const email = String(formData.get("email") ?? "").trim().toLocaleLowerCase("en-US");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) redirect(adminsRedirect("admin-invalid-email"));

  let matchedUser: { id: string } | null = null;
  let page = 1;
  while (!matchedUser) {
    const result = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) redirect(adminsRedirect("admin-list-failed"));
    matchedUser = result.data.users.find((user) => user.email?.toLocaleLowerCase("en-US") === email) ?? null;
    if (matchedUser || result.data.users.length < 1000) break;
    page += 1;
  }
  if (!matchedUser) redirect(adminsRedirect("admin-user-not-found"));

  const { data: existingAdmin, error: lookupError } = await adminClient
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", matchedUser.id)
    .maybeSingle();
  if (lookupError) redirect(adminsRedirect("admin-grant-failed"));
  if (existingAdmin) redirect(adminsRedirect("admin-already-admin"));

  const { error } = await adminClient.from("platform_admins").insert({ user_id: matchedUser.id });
  if (error) redirect(adminsRedirect("admin-grant-failed"));

  revalidatePath("/admin/admins");
  revalidatePath("/admin/accounts");
  revalidatePath("/admin");
  redirect(adminsRedirect("admin-granted"));
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
