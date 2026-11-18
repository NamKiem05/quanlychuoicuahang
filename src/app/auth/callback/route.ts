import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/login?message=verification-failed", request.url));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/login?message=verification-failed", request.url));
  }

  const { data: access, error: accessError } = await supabase.rpc("platform_account_access");
  if (accessError || !["admin", "admin_inactive", "merchant"].includes(access)) {
    return NextResponse.redirect(new URL("/login?message=account-access-failed", request.url));
  }
  if (access !== "merchant") return NextResponse.redirect(new URL("/admin", request.url));
  if (request.nextUrl.searchParams.get("next") === "staff-invitations") return NextResponse.redirect(new URL("/staff-invitations", request.url));
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL("/login?message=account-access-failed", request.url));
  const memberships = await supabase.from("store_members").select("store_id").eq("user_id", auth.user.id).limit(2);
  if (memberships.error) return NextResponse.redirect(new URL("/login?message=account-access-failed", request.url));
  return NextResponse.redirect(new URL((memberships.data?.length ?? 0) > 1 ? "/select-store" : "/dashboard", request.url));
}
