"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function completedAt(value: FormDataEntryValue | null) {
  const input = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input)) return null;
  const parsed = new Date(`${input}:00+07:00`);
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() > Date.now() + 60000) return null;
  // Reject normalized invalid dates such as February 30.
  const local = new Date(parsed.getTime() + 7 * 3600000).toISOString().slice(0, 16);
  return local === input ? parsed.toISOString() : null;
}
export async function recordBackup(form: FormData) {
  const supabase = await createClient();
  const userId = await requirePlatformAdminAccess(supabase);
  const scope = String(form.get("scope") ?? "");
  const result = String(form.get("result") ?? "");
  const integrity = String(form.get("integrity") ?? "");
  const reference = String(form.get("reference") ?? "").trim();
  const notes = String(form.get("notes") ?? "").trim();
  const completed = completedAt(form.get("completed_at"));
  if (!["database", "images", "store_files", "other"].includes(scope) || !["success", "failed"].includes(result) || !["not_checked", "passed", "failed"].includes(integrity) || (result === "failed" && integrity === "passed") || !completed || reference.length < 1 || reference.length > 160 || notes.length > 1000) redirect("/admin/backups?message=invalid");
  const { error } = await supabase.from("backup_records").insert({ scope, result, integrity_result: integrity, reference, notes, completed_at: completed, recorded_by: userId });
  if (error) redirect("/admin/backups?message=failed");
  revalidatePath("/admin/backups");
  redirect("/admin/backups?message=backup-recorded");
}
export async function recordRestore(form: FormData) {
  const supabase = await createClient();
  const userId = await requirePlatformAdminAccess(supabase);
  const id = String(form.get("backup_id") ?? "");
  const target = String(form.get("target") ?? "");
  const result = String(form.get("result") ?? "");
  const notes = String(form.get("notes") ?? "").trim();
  const completed = completedAt(form.get("completed_at"));
  if (!uuid.test(id) || !["test", "production", "other"].includes(target) || !["success", "failed"].includes(result) || !completed || notes.length > 1000) redirect("/admin/backups?message=invalid");
  const backup = await supabase.from("backup_records").select("id, result").eq("id", id).maybeSingle();
  if (backup.error || !backup.data || backup.data.result !== "success") redirect("/admin/backups?message=invalid-backup");
  const { error } = await supabase.from("backup_restore_records").insert({ backup_id: id, target, result, completed_at: completed, notes, recorded_by: userId });
  if (error) redirect("/admin/backups?message=failed");
  revalidatePath("/admin/backups");
  redirect("/admin/backups?message=restore-recorded");
}
