"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { invoiceUuid, validInvoiceDay } from "@/lib/admin/invoices";

export async function createInvoice(formData: FormData) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const id = String(formData.get("payment_id") ?? "");
  if (!invoiceUuid.test(id)) redirect("/admin/invoices?message=invalid");
  const issue = String(formData.get("issue_on") ?? "");
  const due = String(formData.get("due_on") ?? "");
  const description = String(formData.get("description") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  if (!validInvoiceDay(issue) || !validInvoiceDay(due) || issue > due || description.length > 500 || note.length > 1000) {
    redirect(`/admin/invoices/new?payment=${id}&message=invalid`);
  }
  const { data, error } = await supabase.rpc("admin_issue_service_invoice", {
    requested_payment: id, issue_on: issue, due_date: due, service_description: description, note,
  });
  if (error || !data) redirect(`/admin/invoices/new?payment=${id}&message=failed`);
  revalidatePath("/admin/invoices");
  revalidatePath("/merchant-plan");
  redirect(`/admin/invoices/${data}?message=issued`);
}
export async function cancelInvoice(formData: FormData) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const id = String(formData.get("invoice_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!invoiceUuid.test(id)) redirect("/admin/invoices?message=invalid");
  if (reason.length < 5 || reason.length > 500) redirect(`/admin/invoices/${id}?message=invalid`);
  const { error } = await supabase.rpc("admin_cancel_service_invoice", { requested_invoice: id, reason });
  if (error) redirect(`/admin/invoices/${id}?message=failed`);
  revalidatePath("/admin/invoices");
  revalidatePath("/merchant-plan");
  revalidatePath(`/admin/invoices/${id}`);
  redirect(`/admin/invoices/${id}?message=cancelled`);
}

export async function recordInvoiceTransfer(formData: FormData) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const id = String(formData.get("invoice_id") ?? "");
  if (!invoiceUuid.test(id)) redirect("/admin/invoices?message=invalid");
  const path = `/admin/invoices/${id}`;
  const rawAmount = String(formData.get("amount") ?? "");
  const paidAt = String(formData.get("paid_at") ?? "");
  const reference = String(formData.get("reference") ?? "").trim().toUpperCase();
  const note = String(formData.get("note") ?? "").trim();
  if (!/^[1-9][0-9]{0,9}$/.test(rawAmount) || Number(rawAmount) > 2147483647
    || !validInvoiceDay(paidAt.slice(0, 10)) || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(paidAt)
    || !/^[A-Z0-9][A-Z0-9 ./_-]{2,119}$/.test(reference) || note.length > 1000) {
    redirect(`${path}?message=transfer-invalid`);
  }
  const { error } = await supabase.rpc("admin_record_service_invoice_transfer", {
    requested_invoice: id, amount: Number(rawAmount), paid_on: `${paidAt}+07:00`, reference, note,
  });
  if (error) redirect(`${path}?message=${error.code === "23505" ? "duplicate-transfer" : "transfer-failed"}`);
  revalidatePath("/admin/invoices");
  revalidatePath(path);
  revalidatePath("/merchant-plan");
  redirect(`${path}?message=recorded`);
}
