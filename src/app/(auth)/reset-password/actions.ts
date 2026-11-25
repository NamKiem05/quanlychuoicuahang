"use server";

import { isAuthRetryableFetchError, isAuthSessionMissingError } from "@supabase/supabase-js";
import { validateRecoveryPassword } from "@/lib/auth/password";
import { clearRecoveryCookies, createRecoveryClient, readRecoveryContext, saveRecoveryContext } from "@/lib/supabase/recovery";

function isInvalidSession(error: { code?: string; status?: number }) {
  return isAuthSessionMissingError(error) || error.status === 401 || error.status === 403 ||
    error.code === "session_not_found" || error.code === "session_expired" ||
    error.code === "refresh_token_not_found" || error.code === "refresh_token_already_used" ||
    error.code === "bad_jwt" || error.code === "user_not_found";
}

function verificationUnavailable(step: "session" | "claims" | "session-policy" | "unexpected", error?: { code?: string; status?: number }) {
  console.error("Password recovery verification failed", {
    step,
    code: error?.code?.match(/^[a-zA-Z0-9_]{1,64}$/)?.[0],
    status: error?.status,
  });
  return { status: "unavailable" } as const;
}

async function verifyRecovery(id: string) {
  const context = await readRecoveryContext();
  if (!context || context.id !== id) return { status: "invalid" } as const;

  const supabase = await createRecoveryClient();
  const session = await supabase.auth.getSession();
  if (session.error) return isInvalidSession(session.error)
    ? { status: "invalid" } as const
    : verificationUnavailable("session", session.error);
  const token = session.data.session?.access_token;
  if (!token) return { status: "invalid" } as const;

  const { data: verified, error } = await supabase.auth.getClaims(token);
  if (error) return isInvalidSession(error)
    ? { status: "invalid" } as const
    : verificationUnavailable("claims", error);
  if (verified?.claims.sub !== context.userId || verified.claims.session_id !== context.sessionId) {
    return { status: "invalid" } as const;
  }

  const { data, error: sessionError } = await supabase.rpc("growdesk_session_status", { record_activity: false });
  if (sessionError && sessionError.code !== "PT401") {
    verificationUnavailable("session-policy", sessionError);
    return {
      status: ["PGRST202", "42883", "42501"].includes(sessionError.code) ? "service-unavailable" : "unavailable",
    } as const;
  }
  if (sessionError || data?.status !== "active") return { status: "invalid" } as const;
  return { status: "ready", supabase, token, context } as const;
}

export async function checkPasswordRecovery(id: string) {
  try {
    const context = await readRecoveryContext();
    if (context?.id === id && context.passwordUpdated) return "sign-out-pending";
    return (await verifyRecovery(id)).status;
  } catch {
    return verificationUnavailable("unexpected").status;
  }
}

async function revokeSessions(supabase: Awaited<ReturnType<typeof createRecoveryClient>>, token: string) {
  try {
    // The high-level signOut suppresses some 4xx responses. Check the response using the same user JWT.
    const { error } = await supabase.auth.admin.signOut(token, "global");
    if (error) return "sign-out-pending";
    await clearRecoveryCookies();
    return "updated";
  } catch {
    return "sign-out-pending";
  }
}

export async function updateRecoveryPassword(id: string, password: string, confirmation: string) {
  if (typeof password !== "string" || typeof confirmation !== "string" || password.length > 128 || confirmation.length > 128) {
    return { status: "validation", message: "Mật khẩu không hợp lệ." } as const;
  }
  const message = validateRecoveryPassword(password, confirmation);
  if (message) return { status: "validation", message } as const;

  try {
    const recovery = await verifyRecovery(id);
    if (recovery.status !== "ready") return { status: recovery.status } as const;
    const { supabase, token, context } = recovery;
    if (context.passwordUpdated) return { status: await revokeSessions(supabase, token) } as const;

    const { data, error: userError } = await supabase.auth.getUser(token);
    if (userError) return { status: isInvalidSession(userError) ? "invalid" : "unavailable" } as const;
    if (data.user.id !== context.userId) return { status: "invalid" } as const;

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      if (isInvalidSession(error)) return { status: "invalid" } as const;
      if (error.code === "weak_password") {
        return { status: "validation", message: "Mật khẩu chưa đáp ứng chính sách bảo mật. Hãy chọn mật khẩu khác." } as const;
      }
      if (error.code === "same_password") {
        return { status: "validation", message: "Mật khẩu này đã là mật khẩu hiện tại. Nếu lần lưu trước bị gián đoạn, anh có thể thử đăng nhập bằng mật khẩu này." } as const;
      }
      if (isAuthRetryableFetchError(error)) return { status: "uncertain" } as const;
      return { status: "unavailable" } as const;
    }

    await saveRecoveryContext({ ...context, passwordUpdated: true });
    return { status: await revokeSessions(supabase, token) } as const;
  } catch {
    return { status: "uncertain" } as const;
  }
}

export async function retryRecoverySignOut(id: string) {
  try {
    const recovery = await verifyRecovery(id);
    if (recovery.status !== "ready" || !recovery.context.passwordUpdated) return "sign-out-pending";
    return revokeSessions(recovery.supabase, recovery.token);
  } catch {
    return "sign-out-pending";
  }
}
