"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function PaymentRefresh() {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!document.hidden && !refreshing) startTransition(() => router.refresh());
    }, 8000);
    return () => window.clearInterval(interval);
  }, [refreshing, router]);

  return (
    <button type="button" className="secondary-submit" onClick={() => startTransition(() => router.refresh())} disabled={refreshing}>
      {refreshing ? "Đang kiểm tra…" : "Kiểm tra thanh toán"}
    </button>
  );
}
