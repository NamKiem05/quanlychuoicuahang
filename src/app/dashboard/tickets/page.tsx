import { getMerchantContext } from "../data";
import { TicketList } from "@/app/support-tickets/shared";
export default async function MerchantTickets({ searchParams }: { searchParams: Promise<{ message?: string; page?: string }> }) {
  const [{ supabase, store }, query] = await Promise.all([getMerchantContext(), searchParams]);
  const page = typeof query.page === "string" && /^[1-9]\d{0,5}$/.test(query.page) ? Number(query.page) : 1;
  return <TicketList supabase={supabase} admin={false} stores={store ? [{ id: store.id, name: store.name }] : []} storeId={store?.id} message={query.message} page={page} />;
}
