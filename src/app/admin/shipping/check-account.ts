import "server-only";
import { verifyGhnShop } from "@/lib/shipping/ghn";
import { decryptShippingToken } from "@/lib/shipping/account-credentials";
import type { Account } from "./model";

type CheckResult = { status: "verified" | "not_configured" | "failed"; error: string | null };

export async function verifyShippingAccount(
  account: Account & { credential_ciphertext: string | null },
  catalogEnabled: boolean,
  deadline = AbortSignal.timeout(20000),
): Promise<CheckResult> {
  if (account.scope !== "platform" || account.provider_code !== "ghn" || account.environment !== "sandbox") {
    return { status: "not_configured", error: "UNSUPPORTED" };
  }
  if (!catalogEnabled) return { status: "not_configured", error: "PROVIDER_DISABLED" };
  if (process.env.SHIPPING_GHN_SANDBOX_CHECKS_ENABLED !== "true") {
    return { status: "not_configured", error: "CHECK_DISABLED" };
  }
  if (!account.credential_ciphertext) return { status: "not_configured", error: "TOKEN_MISSING" };
  if (!/^[1-9]\d{0,9}$/.test(account.external_shop_id)) {
    return { status: "failed", error: "SHOP_NOT_FOUND" };
  }

  let token: string;
  try {
    token = decryptShippingToken(account.credential_ciphertext, account);
  } catch (error) {
    const missingKey = error instanceof Error && error.message === "KEY_UNAVAILABLE";
    return missingKey
      ? { status: "not_configured", error: "KEY_UNAVAILABLE" }
      : { status: "failed", error: "INVALID_TOKEN" };
  }

  try {
    await verifyGhnShop(token, Number(account.external_shop_id), deadline);
    deadline.throwIfAborted();
    return { status: "verified", error: null };
  } catch (error) {
    if (deadline.aborted || (error instanceof Error && error.message === "GHN_TIMEOUT")) {
      return { status: "failed", error: "PROVIDER_TIMEOUT" };
    }
    switch (error instanceof Error ? error.message : "") {
      case "GHN_SHOP_ACCESS_DENIED": return { status: "failed", error: "SHOP_ACCESS_DENIED" };
      case "GHN_SHOP_NOT_FOUND": return { status: "failed", error: "SHOP_NOT_FOUND" };
      case "GHN_AUTH_OR_SHOP_REJECTED": return { status: "failed", error: "INVALID_TOKEN" };
      default: return { status: "failed", error: "PROVIDER_UNAVAILABLE" };
    }
  }
}
