import { createClient } from "@/lib/supabase/server";
import { requireSupportTicketAccess } from "@/lib/platform-account";
import { TicketList } from "@/app/support-tickets/shared";
export default async function AdminTickets({ searchParams }: { searchParams: Promise<{ message?: string; page?: string }> }) {
  const [supabase, query] = await Promise.all([createClient(), searchParams]);
  await requireSupportTicketAccess(supabase);
  let stores = await supabase.rpc("get_support_store_options");
  if (stores.error?.code === "PGRST202") {
    const fullAdmin = await supabase.rpc("is_platform_admin");
    if (!fullAdmin.error && fullAdmin.data === true) stores = await supabase.from("stores").select("id, name").order("name");
  }
  const page = typeof query.page === "string" && /^[1-9]\d{0,5}$/.test(query.page) ? Number(query.page) : 1;
  if (stores.error) return <main className="admin-content"><p className="admin-error">Không tải được danh sách cửa hàng.</p></main>;
  return <TicketList supabase={supabase} admin stores={stores.data ?? []} message={query.message} page={page} />;
}
