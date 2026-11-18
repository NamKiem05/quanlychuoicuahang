import { notFound } from "next/navigation";
import { getMerchantContext } from "../../data";
import { TicketDetail } from "@/app/support-tickets/shared";
export default async function MerchantTicket({ params, searchParams }: { params: Promise<{ ticketId: string }>; searchParams: Promise<{ message?: string }> }) {
  const [{ ticketId }, query, { supabase, membership }] = await Promise.all([params, searchParams, getMerchantContext()]);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ticketId)) notFound();
  return <TicketDetail supabase={supabase} admin={false} id={ticketId} admins={[]} owner={membership?.role === "owner"} message={query.message} />;
}
