"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useTransition } from "react";
import { syncShipmentStatus } from "./actions";

export default function ShipmentStatus({ storeId, orderId, canSync }: {
  storeId: string;
  orderId: string;
  canSync: boolean;
}) {
  const [result, action, pending] = useActionState(syncShipmentStatus, { ok: false, message: "" });
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();

  useEffect(() => {
    if (!canSync || pending || refreshing) return;

    function refreshWhenVisible() {
      if (!document.hidden) startRefresh(() => router.refresh());
    }

    const interval = window.setInterval(refreshWhenVisible, 5_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [canSync, pending, refreshing, router]);

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
