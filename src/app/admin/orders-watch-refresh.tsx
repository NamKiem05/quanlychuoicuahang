"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export default function OrdersWatchRefresh() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let timer: number | undefined;
    let disposed = false;

    function queueRefresh() {
      if (disposed || document.hidden || timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        if (!document.hidden) router.refresh();
      }, 250);
    }

    const channel = supabase.channel("admin-orders-watch")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, queueRefresh)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") queueRefresh();
      });
    const interval = window.setInterval(queueRefresh, 30_000);
    document.addEventListener("visibilitychange", queueRefresh);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", queueRefresh);
      void supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
