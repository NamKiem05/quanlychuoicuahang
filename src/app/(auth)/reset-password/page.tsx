import { readRecoveryContext } from "@/lib/supabase/recovery";
import { RecoveryFrame } from "../recovery-frame";
import ResetPasswordForm from "./reset-password-form";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const { error } = await searchParams;
  const context = error ? null : await readRecoveryContext();
  const failure = error === "expired-link" ? "expired" : error === "unavailable" ? "unavailable" : "invalid";
  return <RecoveryFrame><ResetPasswordForm recoveryId={context?.id ?? null} failure={failure} /></RecoveryFrame>;
}
