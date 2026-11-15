"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import notificationStyles from "./chat-notifications.module.css";

type ChatStore = { id: string; name: string };
type ChatMessage = {
  id: string;
  store_id: string;
  sender_id: string | null;
  sender_role: "merchant" | "admin";
  body: string;
  created_at: string;
};
const EMPTY_STORES: ChatStore[] = [];

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const messages = new Map(current.map((message) => [message.id, message]));
  incoming.forEach((message) => messages.set(message.id, message));
  return [...messages.values()]
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .slice(-100);
}

function messageTime(value: string) {
  return new Date(value).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function StoreAdminChat({
  mode,
  theme,
  storeId,
  storeName,
  stores = EMPTY_STORES,
}: {
  mode: "admin" | "merchant";
  theme?: "admin" | "merchant";
  storeId?: string | null;
  storeName?: string;
  stores?: ChatStore[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const storeOptions = mode === "admin"
    ? stores
    : storeId && storeName ? [{ id: storeId, name: storeName }] : [];
  const [selectedStoreId, setSelectedStoreId] = useState(mode === "admin" ? stores[0]?.id ?? "" : storeId ?? "");
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [connection, setConnection] = useState("connecting");
  const [unreadCount, setUnreadCount] = useState(0);
  const [incomingNotice, setIncomingNotice] = useState<ChatMessage | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const isOpenRef = useRef(isOpen);
  const ownRoleRef = useRef(mode);
  isOpenRef.current = isOpen;
  ownRoleRef.current = mode;

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const updateViewport = () => setIsMobileViewport(query.matches);
    updateViewport();
    query.addEventListener("change", updateViewport);
    return () => query.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    if (mode === "merchant") {
      setSelectedStoreId(storeId ?? "");
      return;
    }
    if (!stores.some((store) => store.id === selectedStoreId)) {
      setSelectedStoreId(stores[0]?.id ?? "");
    }
  }, [mode, selectedStoreId, storeId, stores]);

  useEffect(() => {
    if (!selectedStoreId || !isOpen) {
      if (!selectedStoreId) {
        setMessages([]);
        setConnection("idle");
      }
      setIsLoading(false);
      return;
    }

    let disposed = false;
    setMessages([]);
    setIsLoading(true);
    setErrorMessage("");
    void (async () => {
      const { data, error } = await supabase
        .from("store_admin_messages")
        .select("id, store_id, sender_id, sender_role, body, created_at")
        .eq("store_id", selectedStoreId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(100);
      if (disposed) return;
      if (error) setErrorMessage("Chưa tải được tin nhắn. Hãy kiểm tra migration 021 và quyền truy cập.");
      setMessages((current) => mergeMessages(current, ((data ?? []) as ChatMessage[]).reverse()));
      setIsLoading(false);
    })();

    return () => {
      disposed = true;
    };
  }, [isOpen, selectedStoreId, supabase]);

  useEffect(() => {
    if (!selectedStoreId) {
      setConnection("idle");
      return;
    }
    let disposed = false;
    setConnection("connecting");
    const channel = supabase
      .channel(`store-admin-chat:${selectedStoreId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "store_admin_messages",
        filter: `store_id=eq.${selectedStoreId}`,
      }, (payload) => {
        if (disposed) return;
        const message = payload.new as ChatMessage;
        setMessages((current) => mergeMessages(current, [message]));
        if (message.sender_role === ownRoleRef.current || isOpenRef.current) return;
        setUnreadCount((current) => current + 1);
        setIncomingNotice(message);
        if (document.hidden && "Notification" in window && window.Notification.permission === "granted") {
          const browserNotice = new window.Notification("Tin nhắn mới từ quản trị viên", {
            body: message.body,
            tag: message.id,
          });
          browserNotice.onclick = () => {
            window.focus();
            setIsOpen(true);
            setUnreadCount(0);
            setIncomingNotice(null);
            browserNotice.close();
          };
        }
      })
      .subscribe((status) => {
        if (disposed) return;
        setConnection(status === "SUBSCRIBED" ? "connected" : status === "CHANNEL_ERROR" || status === "TIMED_OUT" ? "error" : "connecting");
      });

    return () => {
      disposed = true;
      void supabase.removeChannel(channel);
    };
  }, [selectedStoreId, supabase]);

  useEffect(() => {
    if (!incomingNotice) return;
    const timeoutId = window.setTimeout(() => setIncomingNotice(null), 7000);
    return () => window.clearTimeout(timeoutId);
  }, [incomingNotice?.id]);

  useEffect(() => {
    if (!isOpen) return;
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [isOpen, messages, selectedStoreId]);

  if (!storeOptions.length || !portalTarget) return null;

  const activeStore = storeOptions.find((store) => store.id === selectedStoreId) ?? storeOptions[0];
  const ownRole = mode;

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!selectedStoreId || !body || isSending) return;

    setIsSending(true);
    setErrorMessage("");
    try {
      const { data, error } = await supabase.rpc("send_store_admin_message", {
        requested_store_id: selectedStoreId,
        requested_body: body,
      });
      if (error || !data) {
        setErrorMessage("Chưa gửi được tin nhắn. Hãy thử lại sau.");
        return;
      }
      setMessages((current) => mergeMessages(current, [data as ChatMessage]));
      setDraft("");
    } catch {
      setErrorMessage("Chưa gửi được tin nhắn. Hãy kiểm tra kết nối rồi thử lại.");
    } finally {
      setIsSending(false);
    }
  }

  function submitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function toggleChat() {
    setIsOpen((current) => {
      const next = !current;
      if (next) {
        setUnreadCount(0);
        setIncomingNotice(null);
      }
      return next;
    });
  }

  const notificationToastStyle: CSSProperties = {
    position: "fixed",
    zIndex: 10001,
    right: isMobileViewport ? 12 : 22,
    bottom: isMobileViewport ? "calc(144px + env(safe-area-inset-bottom))" : 82,
    width: "min(390px, calc(100vw - 24px))",
    display: "grid",
    gridTemplateColumns: "36px minmax(0, 1fr) auto 26px",
    alignItems: "center",
    gap: 9,
    padding: 12,
    border: "1px solid #dce5ef",
    borderRadius: 13,
    background: "#fff",
    color: "#26364f",
    boxShadow: "0 14px 38px #15263d2b",
  };
  const notificationCopyStyle: CSSProperties = { minWidth: 0, display: "flex", flexDirection: "column", gap: 4 };
  const notificationBodyStyle: CSSProperties = { display: "block", overflow: "hidden", color: "#748197", fontSize: 10, lineHeight: 1.4, overflowWrap: "anywhere" };
  const launcherBadgeStyle: CSSProperties = {
    position: "absolute",
    top: -7,
    right: -7,
    width: 22,
    minWidth: 22,
    height: 22,
    display: "grid",
    placeItems: "center",
    padding: 0,
    border: "2px solid #fff",
    borderRadius: "50%",
    background: "#ed3348",
    color: "#fff",
    boxShadow: "0 2px 8px #182c1f55",
    fontSize: 10,
    fontWeight: 800,
    lineHeight: 1,
  };

  return createPortal((
    <div
      className={`store-admin-chat is-${theme ?? mode}`}
      style={{ position: "fixed", right: 22, bottom: 22, zIndex: 9999 }}
    >
      {incomingNotice && !isOpen && <div className={notificationStyles.toast} style={notificationToastStyle} role="status" aria-live="polite">
        <span className={notificationStyles.toastIcon} style={{ width: 36, height: 36, display: "grid", placeItems: "center", borderRadius: "50%", background: "#e8f5ec", color: "#087647", fontSize: 16 }} aria-hidden="true">✉</span>
        <span className={notificationStyles.toastCopy} style={notificationCopyStyle}>
          <b style={{ color: "#26364f", fontSize: 11, lineHeight: 1.35 }}>Tin nhắn mới từ quản trị viên</b>
          <small style={notificationBodyStyle}>{incomingNotice.body}</small>
        </span>
        <button className={notificationStyles.toastLink} style={{ minHeight: 30, padding: "0 10px", border: "1px solid #d5eadd", borderRadius: 8, background: "#eff8f1", color: "#087647", fontSize: 10, fontWeight: 700, cursor: "pointer" }} type="button" onClick={() => { setIsOpen(true); setUnreadCount(0); setIncomingNotice(null); }}>Xem</button>
        <button className={notificationStyles.toastClose} style={{ width: 26, height: 26, border: 0, borderRadius: "50%", background: "#f3f6f4", color: "#718078", fontSize: 18, cursor: "pointer" }} type="button" aria-label="Đóng thông báo tin nhắn" onClick={() => setIncomingNotice(null)}>×</button>
      </div>}
      {isOpen && <section className="store-admin-chat-panel" role="dialog" aria-label={mode === "admin" ? "Tin nhắn với cửa hàng" : "Nhắn tin với quản trị viên"}>
        <header className="store-admin-chat-header">
          <div className="store-admin-chat-avatar" aria-hidden="true">✦</div>
          <div className="store-admin-chat-heading">
            <b>{mode === "admin" ? "Tin nhắn cửa hàng" : "Hỗ trợ cửa hàng"}</b>
            <small><span className={`chat-connection-dot is-${connection}`} />{connection === "connected" ? "Đã kết nối trực tiếp" : connection === "error" ? "Mất kết nối trực tiếp" : "Đang kết nối…"}</small>
          </div>
          <button className="store-admin-chat-close" type="button" onClick={() => setIsOpen(false)} aria-label="Đóng khung chat">×</button>
        </header>

        {mode === "admin" && <label className="store-admin-chat-store-select">Cửa hàng
          <select value={selectedStoreId} onChange={(event) => setSelectedStoreId(event.target.value)} aria-label="Chọn cửa hàng cần nhắn tin">
            {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
          </select>
        </label>}

        <div className="store-admin-chat-thread" ref={messageListRef} aria-live="polite" aria-relevant="additions text">
          {isLoading && <p className="store-admin-chat-state">Đang tải tin nhắn…</p>}
          {!isLoading && messages.length === 0 && <div className="store-admin-chat-empty">
            <span aria-hidden="true">✦</span>
            <b>{mode === "admin" ? `Bắt đầu trao đổi với ${activeStore.name}` : "Cần hỗ trợ từ admin?"}</b>
            <p>Gửi tin nhắn tại đây để trao đổi trực tiếp về hoạt động cửa hàng.</p>
          </div>}
          {messages.map((message) => {
            const ownMessage = message.sender_role === ownRole;
            return <article className={`store-admin-chat-message${ownMessage ? " is-own" : ""}`} key={message.id}>
              {!ownMessage && <small>{message.sender_role === "admin" ? "Quản trị viên" : activeStore.name}</small>}
              <p>{message.body}</p>
              <time dateTime={message.created_at}>{messageTime(message.created_at)}</time>
            </article>;
          })}
          <div ref={messageEndRef} />
        </div>

        {errorMessage && <p className="store-admin-chat-error" role="alert">{errorMessage}</p>}
        <form className="store-admin-chat-compose" onSubmit={sendMessage}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={submitOnEnter}
            maxLength={2000}
            rows={2}
            placeholder="Viết tin nhắn…"
            aria-label="Nội dung tin nhắn"
            disabled={!selectedStoreId || isSending}
          />
          <button type="submit" disabled={!draft.trim() || isSending || !selectedStoreId} aria-label="Gửi tin nhắn">
            {isSending ? "…" : "Gửi"}
          </button>
        </form>
        <p className="store-admin-chat-hint">Enter để gửi · Shift + Enter để xuống dòng</p>
      </section>}

      <button className={`store-admin-chat-launcher ${notificationStyles.launcher}`} style={{ position: "relative" }} type="button" onClick={toggleChat} aria-expanded={isOpen} aria-label={isOpen ? "Đóng chat hỗ trợ" : unreadCount ? `${unreadCount} tin nhắn mới, mở chat hỗ trợ` : "Mở chat hỗ trợ"}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 5.75h15a1.75 1.75 0 0 1 1.75 1.75v9a1.75 1.75 0 0 1-1.75 1.75h-8.7l-4.8 2.7v-2.7H4.5a1.75 1.75 0 0 1-1.75-1.75v-9A1.75 1.75 0 0 1 4.5 5.75Z"/><path d="M7 10h10M7 13.5h7"/></svg>
        <span>{isOpen ? "Đóng" : mode === "admin" ? "Tin nhắn" : "Trợ giúp"}</span>
        {!isOpen && unreadCount > 0 && <span className={notificationStyles.badge} style={launcherBadgeStyle}>{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>
    </div>
  ), portalTarget);
}
