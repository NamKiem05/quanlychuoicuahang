"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function createInvoice(formData: FormData) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const id = String(formData.get("payment_id") ?? "");
  if (!uuid.test(id)) redirect("/admin/invoices?message=invalid");
  const { data, error } = await supabase.rpc("admin_create_service_invoice", { requested_payment: id });
  if (error || !data) redirect(`/admin/invoices/new?payment=${id}&message=failed`);
  revalidatePath("/admin/invoices");
  redirect(`/admin/invoices/${data}`);
}
export async function cancelInvoice(formData: FormData) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const id = String(formData.get("invoice_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!uuid.test(id)) redirect("/admin/invoices?message=invalid");
  if (reason.length < 5 || reason.length > 500) redirect(`/admin/invoices/${id}?message=invalid`);
  const { error } = await supabase.rpc("admin_cancel_service_invoice", { requested_invoice: id, reason });
  if (error) redirect(`/admin/invoices/${id}?message=failed`);
  revalidatePath("/admin/invoices");
  revalidatePath(`/admin/invoices/${id}`);
  redirect(`/admin/invoices/${id}?message=cancelled`);
}
