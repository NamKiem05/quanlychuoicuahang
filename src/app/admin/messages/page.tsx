import { createClient } from "@/lib/supabase/server";
import AdminMessages from "./admin-messages";
import "./admin-messages.css";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdminAccess } from "@/lib/platform-account";

export default async function AdminMessagesPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const [{ data }, params] = await Promise.all([
    supabase.from("stores").select("id, name, slug").order("name"),
    searchParams,
  ]);

  let admins: { id: string; name: string }[] = [];
  try {
    const client = createAdminClient();
    const adminRows = await client.from("platform_admins").select("user_id");
    if (!adminRows.error) {
      const ids = (adminRows.data ?? []).map((row) => row.user_id as string);
      const profiles = ids.length ? await client.from("profiles").select("id, display_name").in("id", ids) : { data: [] };
      const names = new Map((profiles.data ?? []).map((profile) => [profile.id, profile.display_name]));
      admins = ids.map((id) => ({ id, name: names.get(id) || `Admin ${id.slice(0, 8)}` }));
    }
  } catch { /* Chat remains usable without assignment configuration. */ }
  return <AdminMessages stores={data ?? []} initialStoreId={params.store} admins={admins} />;
}
