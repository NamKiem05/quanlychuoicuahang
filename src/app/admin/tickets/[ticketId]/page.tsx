import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSupportTicketAccess } from "@/lib/platform-account";
import { TicketDetail } from "@/app/(merchant)/support-tickets/shared";
export default async function AdminTicket({ params, searchParams }: { params: Promise<{ ticketId: string }>; searchParams: Promise<{ message?: string }> }) {
  const [{ ticketId }, query, supabase] = await Promise.all([params, searchParams, createClient()]);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ticketId)) notFound();
  await requireSupportTicketAccess(supabase);
  const [agents, fullAdmin] = await Promise.all([supabase.rpc("get_support_staff"), supabase.rpc("is_platform_admin")]);
  let admins: { id: string; name: string }[] = [];
  if (agents.error?.code === "PGRST202" && !fullAdmin.error && fullAdmin.data === true) {
    try {
      const service = createAdminClient();
      const rows = await service.from("platform_admins").select("user_id");
      if (rows.error) throw rows.error;
      const ids = (rows.data ?? []).map((row) => row.user_id as string);
      const profiles = ids.length ? await service.from("profiles").select("id, display_name").in("id", ids) : { data: [], error: null };
      if (profiles.error) throw profiles.error;
      const names = new Map((profiles.data ?? []).map((profile) => [profile.id, profile.display_name]));
      admins = ids.map((id) => ({ id, name: names.get(id) || `Admin ${id.slice(0, 8)}` }));
    } catch { return <main className="admin-content"><p className="admin-error">Không tải được danh sách quản trị viên để phân công.</p></main>; }
  } else if (agents.error) return <main className="admin-content"><p className="admin-error">Không tải được danh sách nhân viên hỗ trợ để phân công.</p></main>;
  else admins = (agents.data ?? []).map((agent: { user_id: string; display_name: string }) => ({ id: agent.user_id, name: agent.display_name }));
  return <TicketDetail supabase={supabase} admin id={ticketId} admins={admins} owner={false} message={query.message} showStoreLink={fullAdmin.data === true} />;
}
