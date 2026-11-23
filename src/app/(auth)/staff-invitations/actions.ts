"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireMerchantAccount } from "@/lib/platform-account";

export async function respondInvitation(form: FormData) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");
  await requireMerchantAccount(supabase);
  const id = String(form.get("invitation_id") ?? "");
  const decision = String(form.get("decision") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !["accept", "decline"].includes(decision)) redirect("/staff-invitations?message=failed");
  const { error } = await supabase.rpc("respond_store_staff_invitation", { invite_id: id, accept_invitation: decision === "accept" });
  if (error) redirect("/staff-invitations?message=failed");
  revalidatePath("/staff-invitations"); revalidatePath("/dashboard", "layout");
  if (decision === "accept") redirect("/select-store");
  redirect("/staff-invitations?message=declined");
}
