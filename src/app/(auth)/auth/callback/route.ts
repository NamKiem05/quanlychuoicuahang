import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loginDestination, resolveLoginDestination } from "@/lib/auth/login-destination";
import { recoveryHeaders } from "@/lib/auth/recovery-headers";
import { createRecoveryClient, startRecoveryContext } from "@/lib/supabase/recovery";

function redirectWithoutCache(url: URL) {
  return NextResponse.redirect(url, {
    headers: recoveryHeaders,
  });
}

async function completePasswordRecovery(request: NextRequest) {
  const destination = new URL("/reset-password", request.url);
  const code = request.nextUrl.searchParams.get("code");
  const providerError = request.nextUrl.searchParams.get("error_code");
  destination.searchParams.set("error", providerError === "otp_expired" ? "expired-link" : "invalid-link");
  if (!code || providerError) return redirectWithoutCache(destination);

  try {
    const supabase = await createRecoveryClient();
    let isRecovery = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") isRecovery = true;
    });
    const { data, error } = await supabase.auth.exchangeCodeForSession(code).finally(() => subscription.unsubscribe());
    if (error?.code === "flow_state_expired" || error?.code === "otp_expired") {
      destination.searchParams.set("error", "expired-link");
    } else if (isAuthRetryableFetchError(error)) {
      destination.searchParams.set("error", "unavailable");
    }
    // The installed auth-js emits PASSWORD_RECOVERY based on the stored PKCE verifier.
    if (error || !isRecovery || !data.session || !data.user) {
      return redirectWithoutCache(destination);
    }

    const { data: verified, error: claimsError } = await supabase.auth.getClaims(data.session.access_token);
    if (isAuthRetryableFetchError(claimsError)) destination.searchParams.set("error", "unavailable");
    const sessionId = verified?.claims.session_id;
    if (typeof sessionId !== "string" || verified?.claims.sub !== data.user.id) {
      return redirectWithoutCache(destination);
    }
    await startRecoveryContext(data.user.id, sessionId);
    destination.search = "";
  } catch {
    destination.searchParams.set("error", "unavailable");
  }
  return redirectWithoutCache(destination);
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("next") === "reset-password") return completePasswordRecovery(request);
  const destination = loginDestination(request.nextUrl.searchParams);
  const verificationFailure = new URL("/login", request.url);
  verificationFailure.searchParams.set("message", request.nextUrl.searchParams.get("flow") === "oauth" ? "oauth-failed" : "verification-failed");
  if (destination.store) verificationFailure.searchParams.set("store", destination.store);
  if (destination.next) verificationFailure.searchParams.set("next", destination.next);

  const code = request.nextUrl.searchParams.get("code");
  if (!code) return redirectWithoutCache(verificationFailure);

  const supabase = await createClient();
  const exchange = await supabase.auth.exchangeCodeForSession(code).catch(() => null);
  if (!exchange?.data.user || exchange.error) return redirectWithoutCache(verificationFailure);

  const path = await resolveLoginDestination(supabase, exchange.data.user.id, destination).catch(() => null);
  if (path) return redirectWithoutCache(new URL(path, request.url));
  verificationFailure.searchParams.set("message", "account-access-failed");
  return redirectWithoutCache(verificationFailure);
}
