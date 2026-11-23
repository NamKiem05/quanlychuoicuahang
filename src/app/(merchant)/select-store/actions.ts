"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireMerchantAccount } from "@/lib/platform-account";
import { activeStoreCookie } from "@/lib/active-store";

export async function selectStore(form: FormData) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) redirect("/login");
  await requireMerchantAccount(supabase);
  const id = String(form.get("store_id") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) redirect("/select-store?error=invalid");
  const member = await supabase.from("store_members").select("store_id").eq("store_id", id).eq("user_id", userId).maybeSingle();
  if (member.error || !member.data) redirect("/select-store?error=invalid");
  (await cookies()).set(activeStoreCookie, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  redirect("/dashboard");
}
