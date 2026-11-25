import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "./env";

const secure = process.env.NODE_ENV === "production";
const cookiePrefix = secure ? "__Host-" : "";
const storageKey = `${cookiePrefix}growdesk-recovery-auth`;
const contextCookie = `${cookiePrefix}growdesk-recovery-context`;
const recoveryLifetime = 10 * 60;
const cookieOptions = {
  httpOnly: true,
  secure,
  path: "/",
  sameSite: "lax" as const,
};

export async function createRecoveryClient() {
  const { url, publishableKey } = getSupabaseEnv();
  const store = await cookies();
  return createServerClient(url, publishableKey, {
    cookieOptions: { name: storageKey },
    cookies: {
      getAll: () => store.getAll(),
      setAll(values) {
        for (const { name, value, options } of values) {
          const verifier = name.startsWith(`${storageKey}-`);
          store.set(name, value, {
            ...options,
            ...cookieOptions,
            maxAge: value ? (verifier ? 60 * 60 : recoveryLifetime) : 0,
          });
        }
      },
    },
  });
}

type RecoveryContext = {
  id: string;
  userId: string;
  sessionId: string;
  expiresAt: number;
  passwordUpdated: boolean;
};

export async function startRecoveryContext(userId: string, sessionId: string) {
  await saveRecoveryContext({
    id: crypto.randomUUID(),
    userId,
    sessionId,
    expiresAt: Date.now() + recoveryLifetime * 1000,
    passwordUpdated: false,
  });
}

export async function readRecoveryContext() {
  const value = (await cookies()).get(contextCookie)?.value;
  if (!value) return null;
  const [id, userId, sessionId, expiration, phase] = value.split(":");
  const expiresAt = Number(expiration);
  if (!id || !userId || !sessionId || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return null;
  return { id, userId, sessionId, expiresAt, passwordUpdated: phase === "updated" };
}

export async function saveRecoveryContext(context: RecoveryContext) {
  const { id, userId, sessionId, expiresAt, passwordUpdated } = context;
  (await cookies()).set(contextCookie, [id, userId, sessionId, expiresAt, passwordUpdated ? "updated" : "ready"].join(":"), {
    ...cookieOptions,
    maxAge: Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)),
  });
}

export async function clearRecoveryCookies() {
  const store = await cookies();
  const sessionCookies = store.getAll().filter(({ name }) => name === storageKey || name.startsWith(`${storageKey}.`));
  for (const { name } of sessionCookies) {
    store.set(name, "", { ...cookieOptions, maxAge: 0 });
  }
  store.set(contextCookie, "", { ...cookieOptions, maxAge: 0 });
}
