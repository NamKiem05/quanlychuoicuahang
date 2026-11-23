"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function PlatformNoticeLink({ storeId }: { storeId: string }) {
  const [unread, setUnread] = useState<number | null>(null);
  useEffect(() => {
    const supabase = createClient();
    let disposed = false;
    const refresh = async () => {
      if (document.hidden) return;
      const result = await supabase.rpc("count_unread_platform_notifications", { requested_store: storeId });
      if (!disposed) setUnread(result.error ? null : Number(result.data));
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30000);
    document.addEventListener("visibilitychange", refresh);
    return () => { disposed = true; window.clearInterval(interval); document.removeEventListener("visibilitychange", refresh); };
  }, [storeId]);
  return <Link className="platform-notice-toplink" href="/dashboard/notifications" aria-label={unread && unread > 0 ? `${unread} thông báo nền tảng chưa đọc` : "Thông báo nền tảng"}><span aria-hidden="true">♧</span><span>Thông báo</span>{unread !== null && unread > 0 && <b>{unread > 99 ? "99+" : unread}</b>}</Link>;
}
