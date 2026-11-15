import { createClient } from "@/lib/supabase/server";
import AdminMessages from "./admin-messages";
import "./admin-messages.css";

export default async function AdminMessagesPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const supabase = await createClient();
  const [{ data }, params] = await Promise.all([
    supabase.from("stores").select("id, name, slug").order("name"),
    searchParams,
  ]);

  return <AdminMessages stores={data ?? []} initialStoreId={params.store} />;
}
