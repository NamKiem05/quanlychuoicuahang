import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export function getGhnQuoteIpHash(
  request: Request,
  secret = process.env.GHN_QUOTE_RATE_LIMIT_HMAC_KEY,
): string {
  const ip = request.headers.get("x-vercel-forwarded-for")?.trim() ?? "";
  if (!isIP(ip)) throw new Error("GHN_RATE_LIMIT_IP_INVALID");

  const keyText = secret?.trim() ?? "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(keyText)) throw new Error("GHN_RATE_LIMIT_KEY_MISSING");
  const key = Buffer.from(keyText, "base64");
  if (key.length !== 32 || key.toString("base64") !== keyText || keyText === process.env.GHN_CREDENTIALS_ENCRYPTION_KEY?.trim()) {
    throw new Error("GHN_RATE_LIMIT_KEY_INVALID");
  }
  return createHmac("sha256", key).update(ip, "utf8").digest("hex");
}

export async function consumeGhnQuoteRateLimit(
  client: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> },
  ipHash: string,
  storeId: string,
): Promise<{ allowed: boolean; retryAfter: number }> {
  let data: unknown, error: unknown;
  try {
    ({ data, error } = await client.rpc("consume_ghn_quote_rate_limit", {
      requested_ip_hash: ipHash,
      requested_store_id: storeId,
    }));
  } catch {
    throw new Error("GHN_RATE_LIMIT_UNAVAILABLE");
  }
  if (error) throw new Error("GHN_RATE_LIMIT_UNAVAILABLE");

  const result = Array.isArray(data) ? data[0] : data;
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("GHN_RATE_LIMIT_UNAVAILABLE");
  const row = result as Record<string, unknown>;
  if (typeof row.allowed !== "boolean" || !Number.isSafeInteger(row.retry_after) || Number(row.retry_after) < 1 || Number(row.retry_after) > 60) {
    throw new Error("GHN_RATE_LIMIT_UNAVAILABLE");
  }
  return { allowed: row.allowed, retryAfter: Number(row.retry_after) };
}
