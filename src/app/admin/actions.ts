"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function storeListRedirect(formData: FormData, message: string) {
  const params = new URLSearchParams({ message });
  const search = String(formData.get("filter_q") ?? "").trim().replace(/[^\p{L}\p{N}\s+.-]/gu, "").slice(0, 60).trim();
  const status = String(formData.get("filter_status") ?? "").trim();
  if (search) params.set("q", search);
  if (["draft", "active", "paused", "suspended"].includes(status)) params.set("status", status);
  return "/admin/stores?" + params.toString();
}

export async function updateStoreStatus(formData: FormData) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  if (!authData?.claims?.sub) redirect("/login");

  const { data: isAdmin, error: adminError } = await supabase.rpc("is_platform_admin");
  if (adminError || !isAdmin) redirect("/admin?message=not-admin");

  const storeId = String(formData.get("store_id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (!storeId || !["active", "paused", "suspended"].includes(status)) {
    redirect(storeListRedirect(formData, "invalid-status"));
  }

  const { error } = await supabase.rpc("admin_set_store_status", {
    requested_store_id: storeId,
    requested_status: status,
  });

  if (error) redirect(storeListRedirect(formData, "status-update-failed"));
  revalidatePath("/admin");
  revalidatePath("/admin/stores");
  revalidatePath("/");
  redirect(storeListRedirect(formData, "status-updated"));
}

export async function updateAdminReviewStatus(formData: FormData) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  if (!authData?.claims?.sub) redirect("/login");

  const { data: isAdmin, error: adminError } = await supabase.rpc("is_platform_admin");
  if (adminError || !isAdmin) redirect("/admin?message=not-admin");

  const reviewId = String(formData.get("review_id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (!reviewId || !["published", "hidden"].includes(status)) {
    redirect("/admin/reviews?message=invalid-review-status");
  }

  const { data: review, error } = await supabase
    .from("reviews")
    .update({ status })
    .eq("id", reviewId)
    .select("id")
    .maybeSingle();

  if (error || !review) redirect("/admin/reviews?message=review-status-failed");
  revalidatePath("/admin");
  revalidatePath("/admin/reviews");
  revalidatePath("/");
  redirect("/admin/reviews?message=review-status-updated");
}
