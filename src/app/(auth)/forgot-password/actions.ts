"use server";

import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { createRecoveryClient } from "@/lib/supabase/recovery";

const cooldownCookie = "growdesk-recovery-cooldown";
const cooldownSeconds = 60;

export async function requestPasswordReset(address: string) {
  if (typeof address !== "string" || address.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    return { status: "invalid-email" } as const;
  }

  try {
    const origin = (await headers()).get("origin");
    if (!origin) return { status: "unavailable" } as const;
    const redirectTo = new URL("/auth/callback", origin);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(redirectTo.hostname);
    if (redirectTo.origin !== origin || (redirectTo.protocol !== "https:" && !(local && redirectTo.protocol === "http:"))) {
      return { status: "unavailable" } as const;
    }
    redirectTo.searchParams.set("next", "reset-password");

    const store = await cookies();
    if (store.has(cooldownCookie)) return { status: "cooldown" } as const;
    store.set(cooldownCookie, "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: redirectTo.protocol === "https:",
      path: "/forgot-password",
      maxAge: cooldownSeconds,
    });

    const supabase = await createRecoveryClient();
    const { error } = await supabase.auth.resetPasswordForEmail(address, { redirectTo: redirectTo.href });
    // Account-specific responses, including recipient throttling or delivery failure, must look identical.
    const gatewayUnavailable = isAuthRetryableFetchError(error) && [0, 502, 503, 504].includes(error.status);
    return {
      status: gatewayUnavailable ? "unavailable" : "accepted",
    } as const;
  } catch {
    return { status: "unavailable" } as const;
  }
}
