import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

type WebhookPayload = Record<string, unknown>;

function textField(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function sepayResponse(result: string, status = 200) {
  return Response.json({ success: true, result }, { status });
}

async function readPayload(request: Request): Promise<WebhookPayload | null> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body: unknown = await request.json();
      return body && typeof body === "object" && !Array.isArray(body) ? body as WebhookPayload : null;
    }
    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      return Object.fromEntries(Array.from(formData.entries()).map(([key, value]) => [
        key,
        typeof value === "string" ? value : "",
      ]));
    }
  } catch {
    return null;
  }
  return null;
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 16_384) return Response.json({ success: false }, { status: 413 });

  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Apikey\s+([^\s]+)$/i);
  if (!match) {
    console.warn(authorization
      ? "[SePay] Webhook rejected: Authorization header does not use the expected Apikey format."
      : "[SePay] Webhook rejected: Authorization header is missing.");
    return Response.json({ success: false, error: "invalid_authorization_header" }, { status: 401 });
  }

  const secretHash = createHash("sha256").update(match[1]).digest("hex");
  const admin = createAdminClient();
  const { data: key, error: keyError } = await admin
    .from("store_sepay_webhook_keys")
    .select("store_id, enabled")
    .eq("secret_hash", secretHash)
    .maybeSingle();

  if (keyError) return Response.json({ success: false }, { status: 500 });
  if (!key) {
    console.warn("[SePay] Webhook rejected: API Key does not match a configured store.");
    return Response.json({ success: false, error: "invalid_api_key" }, { status: 401 });
  }

  const payload = await readPayload(request);
  if (!payload) return Response.json({ success: false }, { status: 400 });

  if (!key.enabled) {
    const { data: activatedKey, error: activationError } = await admin
      .from("store_sepay_webhook_keys")
      .update({ enabled: true })
      .eq("store_id", key.store_id)
      .eq("secret_hash", secretHash)
      .select("store_id")
      .maybeSingle();
    if (activationError) return Response.json({ success: false }, { status: 500 });
    if (!activatedKey) {
      console.warn("[SePay] Webhook rejected: API Key was replaced before activation.");
      return Response.json({ success: false, error: "invalid_api_key" }, { status: 401 });
    }
  }

  const transactionId = textField(payload.id);
  const accountNumber = textField(payload.accountNumber);
  const transferType = textField(payload.transferType).toLowerCase();
  const amount = Number(payload.transferAmount);
  const transferContent = [
    textField(payload.content),
    textField(payload.code),
    textField(payload.description),
  ].filter(Boolean).join(" ").slice(0, 500);

  // Outgoing transfers and unrelated deposits are acknowledged, but never confirm an order.
  if (transferType !== "in") return sepayResponse("ignored");
  if (!transactionId || transactionId.length > 120 || !accountNumber || accountNumber.length > 30 || !Number.isSafeInteger(amount) || amount <= 0) {
    return Response.json({ success: false }, { status: 400 });
  }

  const paymentReference = transferContent.match(/GD[A-F0-9]{16}/i)?.[0]?.toUpperCase();
  if (!paymentReference) return sepayResponse("ignored");

  const { data: result, error } = await admin.rpc("process_sepay_bank_transfer", {
    requested_store_id: key.store_id,
    requested_transaction_id: transactionId,
    requested_account_number: accountNumber,
    requested_amount_vnd: amount,
    requested_transfer_content: transferContent,
    requested_payment_reference: paymentReference,
  });

  if (error) return Response.json({ success: false }, { status: 500 });
  return sepayResponse(typeof result === "string" ? result : "received");
}
