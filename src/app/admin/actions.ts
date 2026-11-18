"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCname, resolveTxt } from "node:dns/promises";

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

export async function updateAdminStoreProfile(formData: FormData) {
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (isAdmin !== true) redirect("/admin");
  const id = String(formData.get("store_id") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) redirect("/admin/stores");
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (name.length < 2 || name.length > 120 || phone.length > 30 || address.length > 255 || description.length > 2000) redirect(`/admin/stores/${id}/edit?message=invalid`);
  const { data, error } = await supabase.from("stores").update({ name, phone: phone || null, address: address || null, description }).eq("id", id).select("id, slug").maybeSingle();
  if (error || !data) redirect(`/admin/stores/${id}/edit?message=failed`);
  revalidatePath("/admin/stores");
  revalidatePath(`/admin/stores/${id}`);
  revalidatePath(`/${data.slug}`);
  redirect(`/admin/stores/${id}?message=updated`);
}

export async function deleteAdminStore(formData: FormData) {
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (isAdmin !== true) redirect("/admin");
  const id = String(formData.get("store_id") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) redirect("/admin/stores");
  const { error } = await supabase.rpc("admin_delete_empty_store", { requested_store_id: id, confirmation_name: String(formData.get("confirmation_name") ?? "") });
  if (error) redirect(`/admin/stores/${id}/delete?message=${error.code === "23503" ? "has-records" : error.code === "22023" ? "confirmation" : "failed"}`);
  revalidatePath("/admin");
  revalidatePath("/admin/stores");
  revalidatePath("/", "layout");
  redirect("/admin/stores?message=store-deleted");
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

export async function removeAdminStoreDomain(formData: FormData) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  if (!authData?.claims?.sub) redirect("/login");

  const { data: isAdmin, error: adminError } = await supabase.rpc("is_platform_admin");
  if (adminError || !isAdmin) redirect("/admin?message=not-admin");

  const domainId = String(formData.get("domain_id") ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(domainId)) {
    redirect("/admin/domains?message=invalid-domain");
  }

  const { data: deletedDomain, error } = await supabase
    .from("store_domains")
    .delete()
    .eq("id", domainId)
    .select("id")
    .maybeSingle();

  if (error || !deletedDomain) redirect("/admin/domains?message=domain-remove-failed");
  revalidatePath("/admin/domains");
  revalidatePath("/dashboard/domains");
  redirect("/admin/domains?message=domain-removed");
}

export type AdminDomainCheck = { txt?: string; cname?: string; message?: string; success?: boolean };

export async function checkAdminDomain(domainId: string, _previous: AdminDomainCheck): Promise<AdminDomainCheck> {
  void _previous;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!claims?.claims?.sub || isAdmin !== true) return { message: "Không có quyền kiểm tra tên miền." };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(domainId)) return { message: "Tên miền không hợp lệ." };
  const { data: domain, error } = await supabase.from("store_domains").select("id, hostname, domain_type, verification_token, verification_status").eq("id", domainId).maybeSingle();
  if (error || !domain || domain.domain_type !== "custom") return { message: "Không tìm thấy tên miền riêng." };
  const target = (process.env.STORE_DOMAIN_CNAME_TARGET ?? "").trim().replace(/^https?:\/\//i, "").split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/\.+$/, "").toLowerCase();
  if (!target) return { message: "Máy chủ chưa cấu hình STORE_DOMAIN_CNAME_TARGET." };
  const timeout = <T,>(promise: Promise<T>) => new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 5000);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (reason) => { clearTimeout(timer); reject(reason); });
  });
  const [txt, cname] = await Promise.allSettled([timeout(resolveTxt(`_foodgo-verification.${domain.hostname}`)), timeout(resolveCname(domain.hostname))]);
  const txtOk = txt.status === "fulfilled" && txt.value.some((record) => record.join("") === `foodgo-verify=${domain.verification_token}`);
  const cnameOk = cname.status === "fulfilled" && cname.value.some((record) => record.replace(/\.+$/, "").toLowerCase() === target);
  const result: AdminDomainCheck = {
    txt: txtOk ? "TXT xác minh khớp" : txt.status === "rejected" ? "Không truy vấn được TXT hoặc chưa có bản ghi" : "TXT chưa khớp",
    cname: cnameOk ? "CNAME trỏ đúng đích" : cname.status === "rejected" ? "Không truy vấn được CNAME hoặc chưa có bản ghi" : "CNAME chưa trỏ đúng đích",
  };
  if (!txtOk || !cnameOk) return { ...result, message: "Chưa đủ điều kiện xác minh. Kết quả này không tự thay đổi trạng thái đã lưu." };
  if (domain.verification_status !== "verified") {
    try {
      const { data: updated, error: updateError } = await createAdminClient().from("store_domains").update({ verification_status: "verified" }).eq("id", domain.id).eq("hostname", domain.hostname).eq("verification_token", domain.verification_token).select("id").maybeSingle();
      if (updateError || !updated) return { ...result, message: "DNS hợp lệ nhưng không cập nhật được trạng thái xác minh." };
    } catch { return { ...result, message: "DNS hợp lệ nhưng máy chủ chưa thể cập nhật trạng thái xác minh." }; }
  }
  revalidatePath("/admin/domains");
  revalidatePath("/dashboard/domains");
  return { ...result, success: true, message: "DNS hợp lệ và tên miền đã được xác minh. HTTPS cần được cấu hình riêng tại hosting." };
}

