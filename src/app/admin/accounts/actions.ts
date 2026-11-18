"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdminAccess } from "@/lib/platform-account";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function regularAccount(userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle();
  return { admin, allowed: !error && !data };
}

export async function createMerchantAccount(formData: FormData) {
  await requirePlatformAdminAccess(await createClient());
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (name.length < 2 || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || phone.length > 30 || password.length < 8 || password.length > 128) redirect("/admin/accounts/new?message=invalid");
  let created: string | null = null;
  try {
    const { data, error } = await createAdminClient().auth.admin.createUser({ email, password, email_confirm: false, app_metadata: { created_by_platform_admin: true }, user_metadata: { display_name: name, phone } });
    if (!error && data.user) created = data.user.id;
  } catch { /* Report a generic error without exposing service configuration. */ }
  if (!created) redirect("/admin/accounts/new?message=failed");
  revalidatePath("/admin/accounts");
  redirect(`/admin/accounts/${created}?message=created`);
}

export async function updateAccountProfile(formData: FormData) {
  await requirePlatformAdminAccess(await createClient());
  const id = String(formData.get("user_id") ?? "");
  if (!uuidPattern.test(id)) redirect("/admin/accounts");
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  if (name.length < 2 || name.length > 120 || phone.length > 30) redirect(`/admin/accounts/${id}?message=invalid`);
  let saved = false;
  try {
    const { admin, allowed } = await regularAccount(id);
    if (allowed) {
      const { data: user } = await admin.auth.admin.getUserById(id);
      if (user.user) {
        const { error } = await admin.from("profiles").upsert({ id, display_name: name, phone: phone || null });
        saved = !error;
      }
    }
  } catch { /* Keep failures generic. */ }
  if (!saved) redirect(`/admin/accounts/${id}?message=failed`);
  revalidatePath("/admin/accounts");
  revalidatePath(`/admin/accounts/${id}`);
  redirect(`/admin/accounts/${id}?message=updated`);
}

function accountsRedirect(formData: FormData, message: string) {
  const params = new URLSearchParams({ message });
  const search = String(formData.get("filter_q") ?? "").trim().slice(0, 80);
  const status = String(formData.get("filter_status") ?? "").trim();
  const page = Number(formData.get("filter_page"));
  if (search) params.set("q", search);
  if (["active", "suspended"].includes(status)) params.set("status", status);
  if (Number.isSafeInteger(page) && page > 1 && page <= 100_000) params.set("page", String(page));
  return "/admin/accounts?" + params.toString();
}

export async function setAccountAccessStatus(formData: FormData) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  if (!authData?.claims?.sub) redirect("/login");

  const { data: isAdmin, error: adminError } = await supabase.rpc("is_platform_admin");
  if (adminError || !isAdmin) redirect("/admin?message=not-admin");

  const userId = String(formData.get("user_id") ?? "").trim();
  const action = String(formData.get("account_action") ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId) || !["suspend", "reactivate"].includes(action)) {
    redirect(accountsRedirect(formData, "invalid-account-action"));
  }

  if (action === "suspend") {
    if (userId === authData.claims.sub) redirect(accountsRedirect(formData, "account-self-protected"));
    const adminClient = createAdminClient();
    const { data: platformAdmin, error: roleError } = await adminClient
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (roleError) redirect(accountsRedirect(formData, "account-update-failed"));
    if (platformAdmin) redirect(accountsRedirect(formData, "account-admin-protected"));
  }

  const { error } = await createAdminClient().auth.admin.updateUserById(userId, {
    ban_duration: action === "suspend" ? "876000h" : "none",
  });
  if (error) redirect(accountsRedirect(formData, "account-update-failed"));

  revalidatePath("/admin/accounts");
  revalidatePath("/admin");
  redirect(accountsRedirect(formData, action === "suspend" ? "account-suspended" : "account-reactivated"));
}
