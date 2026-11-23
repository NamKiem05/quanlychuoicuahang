"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type OrderNotice = {
  id: string;
  code: string;
  customer: string;
  total: number;
  createdAt: string;
  read: boolean;
  kind: "new_order" | "cancellation_request";
};

type RealtimeOrder = {
  id?: string;
  public_code?: string | null;
  customer_name?: string | null;
  total_vnd?: number | string | null;
  created_at?: string | null;
  cancellation_request_status?: string | null;
  cancellation_requested_at?: string | null;
};

export default function OrderNotificationBell({ storeId, storeName }: { storeId: string | null; storeName: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [notices, setNotices] = useState<OrderNotice[]>([]);
  const [open, setOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [connection, setConnection] = useState("connecting");
  const [toast, setToast] = useState<OrderNotice | null>(null);
  const noticesRef = useRef<OrderNotice[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const soundEnabledRef = useRef(false);
  const toastTimerRef = useRef<number | null>(null);
  const refreshOrderViews = useEffectEvent(() => {
    if (pathname === "/dashboard" || pathname === "/dashboard/orders") router.refresh();
  });

  useEffect(() => {
    if (!storeId) return;
    // Audio playback requires a user gesture in each browser session.
    soundEnabledRef.current = false;

    const supabase = createClient();
    let orderRefreshTimer: number | undefined;
    const queueOrderRefresh = () => {
      if (orderRefreshTimer !== undefined) window.clearTimeout(orderRefreshTimer);
      orderRefreshTimer = window.setTimeout(() => {
        orderRefreshTimer = undefined;
        refreshOrderViews();
      }, 150);
    };
    const publishNotice = (notice: OrderNotice) => {
      const next = [notice, ...noticesRef.current.filter((item) => item.id !== notice.id)].slice(0, 30);
      noticesRef.current = next;
      setNotices(next);
      setToast(notice);
      if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => setToast(null), 7000);

      if (soundEnabledRef.current && audioContextRef.current?.state === "running") playChime(audioContextRef.current);
      if (document.hidden && "Notification" in window && window.Notification.permission === "granted") {
        const browserNotice = new window.Notification(
          `${notice.kind === "cancellation_request" ? "Yêu cầu hủy đơn" : "Đơn mới"} ${notice.code}`,
          {
            body: `${notice.customer} · ${notice.total.toLocaleString("vi-VN")}₫ · ${storeName}`,
            tag: notice.id,
          },
        );
        browserNotice.onclick = () => {
          window.focus();
          router.push("/dashboard/orders");
          browserNotice.close();
        };
      }
    };
    const channel = supabase
      .channel(`store-orders:${storeId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "orders",
        filter: `store_id=eq.${storeId}`,
      }, (payload) => {
        const row = payload.new as RealtimeOrder;
        if (!row.id) return;
        queueOrderRefresh();
        const notice: OrderNotice = {
          id: row.id,
          code: row.public_code || "Đơn mới",
          customer: row.customer_name || "Khách hàng",
          total: Number(row.total_vnd ?? 0),
          createdAt: row.created_at || new Date().toISOString(),
          read: false,
          kind: "new_order",
        };
        publishNotice(notice);
      })
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "orders",
        filter: `store_id=eq.${storeId}`,
      }, (payload) => {
        queueOrderRefresh();
        const row = payload.new as RealtimeOrder;
        if (!row.id || row.cancellation_request_status !== "pending" || !row.cancellation_requested_at) return;
        const notice: OrderNotice = {
          id: `${row.id}:cancellation:${row.cancellation_requested_at}`,
          code: row.public_code || "Đơn hàng",
          customer: row.customer_name || "Khách hàng",
          total: Number(row.total_vnd ?? 0),
          createdAt: row.cancellation_requested_at,
          read: false,
          kind: "cancellation_request",
        };
        if (noticesRef.current.some((item) => item.id === notice.id)) return;
        publishNotice(notice);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") queueOrderRefresh();
        setConnection(status === "SUBSCRIBED" ? "connected" : status === "CHANNEL_ERROR" || status === "TIMED_OUT" ? "error" : "connecting");
      });

    return () => {
      if (orderRefreshTimer !== undefined) window.clearTimeout(orderRefreshTimer);
      void supabase.removeChannel(channel);
      if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
      if (audioContextRef.current) void audioContextRef.current.close();
    };
  }, [router, storeId, storeName]);

  if (!storeId) return null;

  const unreadCount = notices.filter((notice) => !notice.read).length;
  const saveNotices = (next: OrderNotice[]) => {
    noticesRef.current = next;
    setNotices(next);
  };

  const toggleSound = async () => {
    const nextValue = !soundEnabled;
    soundEnabledRef.current = nextValue;
    setSoundEnabled(nextValue);
    if (!nextValue) return;
    try {
      const context = audioContextRef.current ?? new window.AudioContext();
      audioContextRef.current = context;
      await context.resume();
      playChime(context);
    } catch {
      soundEnabledRef.current = false;
      setSoundEnabled(false);
    }
  };

  const enableBrowserNotifications = async () => {
    if (!("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    const nextPermission = await window.Notification.requestPermission();
    setPermission(nextPermission);
  };

  const markAllRead = () => saveNotices(noticesRef.current.map((notice) => ({ ...notice, read: true })));

  return (
    <div className="order-notification-wrap">
      {toast && (
        <div className="order-notification-toast" role="status">
          <span className="order-notification-toast-icon">♬</span>
          <div><b>{toast.kind === "cancellation_request" ? "Khách yêu cầu hủy ·" : "Có đơn hàng mới ·"} {toast.code}</b><small>{toast.customer} · {toast.total.toLocaleString("vi-VN")}₫</small></div>
          <Link href="/dashboard/orders" onClick={() => {
            saveNotices(noticesRef.current.map((notice) => notice.id === toast.id ? { ...notice, read: true } : notice));
            setToast(null);
          }}>Xem đơn</Link>
          <button type="button" aria-label="Đóng thông báo" onClick={() => setToast(null)}>×</button>
        </div>
      )}
      <div className="order-notification-anchor">
        <button
          className="order-notification-bell"
          type="button"
          aria-label={unreadCount ? `${unreadCount} thông báo đơn hàng chưa xem` : "Thông báo đơn hàng"}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => {
            if ("Notification" in window) setPermission(window.Notification.permission);
            else setPermission("unsupported");
            setOpen((value) => !value);
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
          {unreadCount > 0 && <span className="order-notification-count">{unreadCount > 99 ? "99+" : unreadCount}</span>}
        </button>
        {open && (
          <section className="order-notification-popover" role="dialog" aria-label="Thông báo đơn hàng">
            <header><div><b>Thông báo đơn hàng</b><small className={`order-notification-connection ${connection}`}><span />{connection === "connected" ? "Đang nhận đơn mới" : connection === "error" ? "Mất kết nối Realtime" : "Đang kết nối…"}</small></div>
              {unreadCount > 0 && <button type="button" onClick={markAllRead}>Đánh dấu đã xem</button>}
            </header>
            <div className="order-notification-list">
              {notices.length ? notices.map((notice) => (
                <Link
                  className={`order-notification-item${notice.read ? "" : " unread"}`}
                  href="/dashboard/orders"
                  key={notice.id}
                  onClick={() => {
                    saveNotices(noticesRef.current.map((item) => item.id === notice.id ? { ...item, read: true } : item));
                    setOpen(false);
                  }}
                >
                  <span className="order-notification-dot" />
                  <span><b>{notice.kind === "cancellation_request" ? "Yêu cầu hủy" : "Đơn mới"} {notice.code}</b><small>{notice.customer} · {notice.total.toLocaleString("vi-VN")}₫</small><small>{new Date(notice.createdAt).toLocaleString("vi-VN")}</small></span>
                </Link>
              )) : <p className="order-notification-empty">Chưa có đơn hàng mới.</p>}
            </div>
            <footer>
              <button type="button" onClick={() => void toggleSound()}>{soundEnabled ? "♪ Âm báo đang bật" : "♩ Bật âm báo"}</button>
              {permission === "default" && <button type="button" onClick={() => void enableBrowserNotifications()}>Bật thông báo trình duyệt</button>}
              {permission === "granted" && <span>Thông báo trình duyệt đã bật</span>}
              {permission === "denied" && <span>Thông báo trình duyệt đang bị chặn</span>}
              {permission === "unsupported" && <span>Trình duyệt không hỗ trợ thông báo</span>}
            </footer>
          </section>
        )}
      </div>
    </div>
  );
}

function playChime(context: AudioContext) {
  const now = context.currentTime;
  [740, 980].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startAt = now + index * 0.16;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.14, startAt + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.14);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + 0.15);
  });
}
