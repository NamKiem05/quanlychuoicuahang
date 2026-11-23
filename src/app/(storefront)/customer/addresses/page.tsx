import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import AddressManager from "./address-manager";
import "./addresses.css";

export const metadata = { title: "Địa chỉ nhận hàng | GrowDesk" };
export const instant = false;
export default async function CustomerAddresses() {
  await connection();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=customer-account");
  const { data, error } = await supabase.from("customer_addresses").select("id,recipient_name,phone,address").eq("user_id", user.id).order("created_at", { ascending: false });
  return <AddressManager initialAddresses={data || []} initialError={Boolean(error)} />;
}
