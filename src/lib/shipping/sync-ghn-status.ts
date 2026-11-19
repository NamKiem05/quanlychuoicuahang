import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { decryptGhnToken, getGhnShipmentStatus } from "./ghn";

export async function syncGhnStatus(
  admin: ReturnType<typeof createAdminClient>,
  shipment: { storeId: string; orderId: string; shopId: number; orderCode: string; clientOrderCode: string },
  tokenCiphertext: string,
) {
  const checkedAt = new Date().toISOString();
  const status = await getGhnShipmentStatus(decryptGhnToken(tokenCiphertext, shipment.storeId), shipment);
  const { error } = await admin.from("store_ghn_shipments")
    .update({ provider_status: status, status_checked_at: checkedAt })
    .eq("store_id", shipment.storeId).eq("order_id", shipment.orderId).eq("state", "created")
    .eq("shop_id", shipment.shopId).eq("order_code", shipment.orderCode)
    .eq("client_order_code", shipment.clientOrderCode)
    .or(`status_checked_at.is.null,status_checked_at.lt.${checkedAt}`);
  if (error) throw error;
}
