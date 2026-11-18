"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { randomUUID } from "node:crypto";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function base(form: FormData) { return form.get("context") === "admin" ? "/admin/tickets" : "/dashboard/tickets"; }
function text(form: FormData, key: string) { return String(form.get(key) ?? "").trim(); }

export async function createTicket(form: FormData) {
  const supabase = await createClient();
  const target = base(form);
  const store = text(form, "store_id");
  if (!uuid.test(store)) redirect(`${target}?message=invalid`);
  const { data, error } = await supabase.rpc("create_support_ticket", { target_store: store, title: text(form, "subject"), kind: text(form, "category"), message: text(form, "body") });
  if (error || !data) redirect(`${target}?message=failed`);
  revalidatePath(target);
  redirect(`${target}/${data}`);
}
export async function replyTicket(form: FormData) {
  const supabase = await createClient();
  const target = base(form);
  const id = text(form, "ticket_id");
  if (!uuid.test(id)) redirect(target);
  const { error } = await supabase.rpc("reply_support_ticket", { target_ticket: id, message: text(form, "body") });
  if (error) redirect(`${target}/${id}?message=failed`);
  revalidatePath(`${target}/${id}`);
  redirect(`${target}/${id}`);
}
export async function updateTicket(form: FormData) {
  const supabase = await createClient();
  const id = text(form, "ticket_id");
  if (!uuid.test(id)) redirect("/admin/tickets");
  const assignee = text(form, "assigned_to");
  if (assignee && !uuid.test(assignee)) redirect(`/admin/tickets/${id}?message=invalid`);
  const { error } = await supabase.rpc("admin_update_support_ticket", { target_ticket: id, next_status: text(form, "status"), next_category: text(form, "category"), assignee: assignee || null });
  if (error) redirect(`/admin/tickets/${id}?message=failed`);
  revalidatePath("/admin/tickets");
  revalidatePath(`/admin/tickets/${id}`);
  redirect(`/admin/tickets/${id}?message=updated`);
}
export async function rateTicket(form: FormData) {
  const supabase = await createClient();
  const id = text(form, "ticket_id");
  if (!uuid.test(id)) redirect("/dashboard/tickets");
  const stars = Number(text(form, "stars"));
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) redirect(`/dashboard/tickets/${id}?message=invalid`);
  const { error } = await supabase.rpc("rate_support_ticket", { target_ticket: id, stars, note: text(form, "note") });
  if (error) redirect(`/dashboard/tickets/${id}?message=failed`);
  revalidatePath(`/dashboard/tickets/${id}`);
  redirect(`/dashboard/tickets/${id}?message=rated`);
}

export async function uploadTicketAttachment(form: FormData) {
  const supabase = await createClient();
  const target = base(form);
  const id = text(form, "ticket_id");
  if (!uuid.test(id)) redirect(target);
  const file = form.get("file");
  if (!(file instanceof File) || file.size < 1 || file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain"].includes(file.type)) redirect(`${target}/${id}?message=file-invalid`);
  const filename = file.name.replace(/[\x00-\x1f\x7f/\\]/g, "").slice(0, 150).trim();
  if (!filename) redirect(`${target}/${id}?message=file-invalid`);
  const path = `${id}/${randomUUID()}`;
  const upload = await supabase.storage.from("support-ticket-files").upload(path, file, { contentType: file.type, upsert: false });
  if (upload.error) redirect(`${target}/${id}?message=file-failed`);
  const result = await supabase.rpc("add_support_ticket_attachment", { target_ticket: id, path, filename });
  if (result.error) {
    await supabase.storage.from("support-ticket-files").remove([path]);
    redirect(`${target}/${id}?message=file-failed`);
  }
  revalidatePath(`${target}/${id}`);
  redirect(`${target}/${id}?message=file-added`);
}
