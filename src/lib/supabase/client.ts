import { createBrowserClient } from "@supabase/ssr";
import { authCookieOptions, getSupabaseEnv } from "./env";

export function createClient() {
  const { url, publishableKey } = getSupabaseEnv();
  return createBrowserClient(url, publishableKey, {
    cookieOptions: authCookieOptions,
    auth: { detectSessionInUrl: false },
  });
}
