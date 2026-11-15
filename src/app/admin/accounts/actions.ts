"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
