"use client";

import { useActionState } from "react";
import { syncShipmentStatus } from "./actions";

export default function ShipmentStatus({ storeId, orderId, canSync }: {
  storeId: string;
  orderId: string;
  canSync: boolean;
}) {
  const [result, action, pending] = useActionState(syncShipmentStatus, { ok: false, message: "" });

  return (
    <form action={action}>
      <input type="hidden" name="__active_store_id" value={storeId} />
      <input type="hidden" name="order_id" value={orderId} />
      <div className="ghn-shipment-actions">
        <button type="submit" disabled={pending || !canSync}>
          {pending ? "Đang đồng bộ…" : "Đồng bộ trạng thái GHN"}
        </button>
      </div>
      {result.message && <p role={result.ok ? "status" : "alert"}>{result.message}</p>}
    </form>
  );
}
