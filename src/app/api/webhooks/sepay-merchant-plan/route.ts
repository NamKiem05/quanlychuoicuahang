import { createHash, timingSafeEqual } from "node:crypto";
import { getMerchantPlanWebhookSecret, getPlatformBankAccount } from "@/lib/merchant-billing";
import { createAdminClient } from "@/lib/supabase/admin";

function textField(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

export async function POST(request: Request) {
  const secret = getMerchantPlanWebhookSecret();
  const bank = getPlatformBankAccount();
  if (!secret || !bank) return Response.json({ success: false }, { status: 503 });
  const providedKey = request.headers.get("authorization")?.match(/^Apikey\s+([^\s]+)$/i)?.[1];
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!providedKey || !timingSafeEqual(digest(providedKey), digest(secret))) {
    return Response.json({ success: false }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    if (Number(request.headers.get("content-length")) > 16_384) return Response.json({ success: false }, { status: 413 });
    const body = await request.text();
    if (body.length > 16_384) return Response.json({ success: false }, { status: 413 });
    const decoded: unknown = JSON.parse(body);
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("Invalid JSON object");
    payload = decoded as Record<string, unknown>;
  } catch {
    return Response.json({ success: false }, { status: 400 });
  }

  if (textField(payload.transferType).toLowerCase() !== "in" || textField(payload.accountNumber) !== bank.account_number) {
    return Response.json({ success: true, result: "ignored" });
  }
  const codes = new Set([payload.code, payload.content, payload.description]
    .flatMap((field) => textField(field).toUpperCase().match(/\bGGP[A-F0-9]{16}\b/g) ?? []));
  if (codes.size !== 1) return Response.json({ success: true, result: "ignored" });
  const [paymentCode] = codes;
  const transactionId = textField(payload.id);
  const amount = Number(textField(payload.transferAmount));
  if (!transactionId || transactionId.length > 120 || !Number.isInteger(amount) || amount <= 0 || amount > 2147483647) {
    return Response.json({ success: false }, { status: 400 });
  }

  const { data, error } = await createAdminClient().rpc("confirm_merchant_plan_transfer", {
    payment_code: paymentCode,
    received_amount: amount,
    transaction_id: transactionId,
  });
  if (error) return Response.json({ success: false }, { status: 500 });
  return Response.json({ success: true, result: data });
}
