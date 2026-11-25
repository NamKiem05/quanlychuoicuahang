import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { liveSessionStatus } from "@/lib/platform-account";
import { resolveLoginDestination } from "@/lib/auth/login-destination";
import LoginForm from "./login-form";

async function existingLoginDestination() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    const userId = data?.claims?.sub;
    if (error || !userId || await liveSessionStatus(supabase) !== "active") return null;

    // Ignore URL destinations for an existing session and route by verified account access.
    return await resolveLoginDestination(supabase, userId, {}, { supportWorkspace: true });
  } catch {
    return null;
  }
}

export default async function LoginPage() {
  const destination = await existingLoginDestination();
  if (destination) redirect(destination);
  return <LoginForm />;
}
