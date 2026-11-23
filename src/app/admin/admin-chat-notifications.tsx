"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import styles from "@/components/chat/chat-notifications.module.css";

type ChatStore = { id: string; name: string };
type ChatMessage = {
  id: string;
  store_id: string;
  sender_role: "merchant" | "admin";
  body: string;
  created_at: string;
};
type Notice = { message: ChatMessage; storeName: string };
type ChatNotificationContextValue = {
  unreadByStore: Record<string, number>;
  markStoreRead: (storeId: string) => void;
  setActiveStore: (storeId: string | null) => void;
};

const ChatNotificationContext = createContext<ChatNotificationContextValue | null>(null);

export function useAdminChatNotifications() {
  const context = useContext(ChatNotificationContext);
  if (!context) throw new Error("useAdminChatNotifications must be used within AdminChatNotificationsProvider");
  return context;
}

export default function AdminChatNotificationsProvider({ stores, children }: { stores: ChatStore[]; children: ReactNode }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [unreadByStore, setUnreadByStore] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const activeStoreRef = useRef<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const storeNames = useMemo(() => new Map(stores.map((store) => [store.id, store.name])), [stores]);

  const markStoreRead = useCallback((storeId: string) => {
    setUnreadByStore((current) => current[storeId] ? { ...current, [storeId]: 0 } : current);
  }, []);

  const setActiveStore = useCallback((storeId: string | null) => {
    activeStoreRef.current = storeId;
  }, []);

  useEffect(() => {
    if (!stores.length) return;
    const channel = supabase
      .channel("admin-chat-notifications")
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "store_admin_messages",
      }, (payload) => {
        const message = payload.new as ChatMessage;
        if (message.sender_role !== "merchant") return;
        const storeName = storeNames.get(message.store_id) ?? "Cửa hàng";
        const focusedConversation = activeStoreRef.current === message.store_id && !document.hidden;
        if (focusedConversation) return;

        setUnreadByStore((current) => ({ ...current, [message.store_id]: (current[message.store_id] ?? 0) + 1 }));
        setNotice({ message, storeName });
        if (noticeTimerRef.current != null) window.clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = window.setTimeout(() => setNotice(null), 7000);

        if (document.hidden && "Notification" in window && window.Notification.permission === "granted") {
          const browserNotice = new window.Notification(`Tin nhắn mới · ${storeName}`, {
            body: message.body,
            tag: message.id,
          });
          browserNotice.onclick = () => {
            window.focus();
            router.push(`/admin/messages?store=${encodeURIComponent(message.store_id)}`);
            browserNotice.close();
          };
        }
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
      if (noticeTimerRef.current != null) window.clearTimeout(noticeTimerRef.current);
    };
  }, [router, storeNames, stores.length, supabase]);

  const value = useMemo(() => ({ unreadByStore, markStoreRead, setActiveStore }), [unreadByStore, markStoreRead, setActiveStore]);

  return (
    <ChatNotificationContext.Provider value={value}>
      {children}
      {notice && <div className={styles.toast} role="status" aria-live="polite">
        <span className={styles.toastIcon} aria-hidden="true">✉</span>
        <span className={styles.toastCopy}><b>Tin nhắn mới từ {notice.storeName}</b><small>{notice.message.body}</small></span>
        <Link className={styles.toastLink} href={`/admin/messages?store=${encodeURIComponent(notice.message.store_id)}`} onClick={() => setNotice(null)}>Xem</Link>
        <button className={styles.toastClose} type="button" aria-label="Đóng thông báo tin nhắn" onClick={() => setNotice(null)}>×</button>
      </div>}
    </ChatNotificationContext.Provider>
  );
}
