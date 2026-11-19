import { createHash, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { syncGhnStatus } from "@/lib/shipping/sync-ghn-status";
import { createAdminClient } from "@/lib/supabase/admin";

function hash(value: string) {
  return createHash("sha256").update(value).digest();
}

export async function POST(request: Request) {
  const secret = process.env.GHN_WEBHOOK_SECRET?.trim();
  if (!secret) return new Response(null, { status: 503 });
  const supplied = request.headers.get("x-ghn-webhook-secret");
  if (!supplied || !timingSafeEqual(hash(supplied), hash(secret))) {
    return new Response(null, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !("Type" in body) || typeof body.Type !== "string") {
    return new Response(null, { status: 400 });
  }
  if (body.Type !== "switch_status") return new Response(null, { status: 204 });
  const clientOrderCode = "ClientOrderCode" in body ? body.ClientOrderCode : undefined;
  const cancellationWithoutClientCode = "Status" in body && body.Status === "cancel" &&
    (clientOrderCode == null || clientOrderCode === "");
  if (!("ShopID" in body) || typeof body.ShopID !== "number" || !Number.isSafeInteger(body.ShopID) || body.ShopID <= 0 ||
      !("OrderCode" in body) || typeof body.OrderCode !== "string" || !/^[A-Z0-9]{1,64}$/.test(body.OrderCode)) {
    return new Response(null, { status: 400 });
  }
  const hasGrowdeskCode = typeof clientOrderCode === "string" &&
    /^GD-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(clientOrderCode);
  if (!hasGrowdeskCode && !cancellationWithoutClientCode) {
    return new Response(null, { status: 204 });
  }

  try {
    const admin = createAdminClient();
    const query = admin.from("store_ghn_shipments")
      .select("store_id,order_id,client_order_code")
      .eq("shop_id", body.ShopID).eq("order_code", body.OrderCode).eq("state", "created");
    if (hasGrowdeskCode) query.eq("client_order_code", clientOrderCode);
    const { data: shipment, error } = await query.maybeSingle();
    if (error) throw error;
    if (!shipment) return new Response(null, { status: 204 });

    const { data: connection, error: connectionError } = await admin.from("store_ghn_connections")
      .select("token_ciphertext").eq("store_id", shipment.store_id)
      .eq("shop_id", body.ShopID).eq("environment", "staging").maybeSingle();
    if (connectionError) throw connectionError;
    if (!connection) return new Response(null, { status: 204 });

    // Fetch the current status so delayed or repeated events cannot replay an old status.
    await syncGhnStatus(admin, {
      storeId: shipment.store_id,
      orderId: shipment.order_id,
      shopId: body.ShopID,
      orderCode: body.OrderCode,
      clientOrderCode: shipment.client_order_code,
    }, connection.token_ciphertext);
    revalidatePath(`/dashboard/orders/${shipment.order_id}/shipping`);
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 503 });
  }
}
