"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export default function OverviewRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <button type="button" className="theme-secondary" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
    {pending ? "Đang làm mới…" : "Làm mới dữ liệu"}
  </button>;
}
