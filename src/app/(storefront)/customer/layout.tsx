import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import CustomerShell from "./customer-shell";
import "../../../components/storefront/retail-storefront.css";
import "./customer-shell.css";

export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return children;
  const slug = (await cookies()).get("growdesk_customer_store")?.value;
  const [{ data: profile }, storeResult] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
    slug && /^[a-z0-9-]{1,100}$/i.test(slug)
      ? supabase.from("stores").select("id,name,slug,logo_url,phone").eq("slug", slug).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return <CustomerShell store={storeResult.data} name={profile?.display_name?.trim() || user.email || "Khách hàng"}>{children}</CustomerShell>;
}
