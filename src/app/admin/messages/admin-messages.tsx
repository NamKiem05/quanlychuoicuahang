"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAdminChatNotifications } from "../admin-chat-notifications";

type ChatStore = { id: string; name: string; slug: string };
type ChatMessage = {
  id: string;
  store_id: string;
  sender_id: string | null;
  sender_role: "merchant" | "admin";
  body: string;
  created_at: string;
};

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const merged = new Map(current.map((message) => [message.id, message]));
  incoming.forEach((message) => merged.set(message.id, message));
  return [...merged.values()]
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .slice(-100);
}

function formatTime(value: string, includeDate = false) {
  return new Date(value).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    ...(includeDate ? { day: "2-digit" as const, month: "2-digit" as const } : {}),
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminMessages({ stores, initialStoreId }: { stores: ChatStore[]; initialStoreId?: string }) {
  const supabase = useMemo(() => createClient(), []);
  const { unreadByStore, markStoreRead, setActiveStore } = useAdminChatNotifications();
  const [selectedStoreId, setSelectedStoreId] = useState(initialStoreId && stores.some((store) => store.id === initialStoreId) ? initialStoreId : stores[0]?.id ?? "");
  const [latestByStore, setLatestByStore] = useState<Record<string, ChatMessage>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isMobileThreadOpen, setIsMobileThreadOpen] = useState(false);
  const [connection, setConnection] = useState("connecting");
  const [errorMessage, setErrorMessage] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  const activeStore = stores.find((store) => store.id === selectedStoreId) ?? null;

  useEffect(() => {
    if (initialStoreId && stores.some((store) => store.id === initialStoreId)) {
      setSelectedStoreId(initialStoreId);
    } else if (!stores.some((store) => store.id === selectedStoreId)) {
      setSelectedStoreId(stores[0]?.id ?? "");
    }
  }, [initialStoreId, selectedStoreId, stores]);

  useEffect(() => {
    const updateActiveConversation = () => {
      const threadIsVisible = window.matchMedia("(min-width: 761px)").matches || isMobileThreadOpen;
      const activeStoreId = threadIsVisible ? selectedStoreId : null;
      setActiveStore(activeStoreId);
      if (activeStoreId) markStoreRead(activeStoreId);
    };
    updateActiveConversation();
    window.addEventListener("resize", updateActiveConversation);
    return () => {
      window.removeEventListener("resize", updateActiveConversation);
      setActiveStore(null);
    };
  }, [isMobileThreadOpen, markStoreRead, selectedStoreId, setActiveStore]);

  useEffect(() => {
    if (!stores.length) return;
    let disposed = false;
    void supabase
      .from("store_admin_messages")
      .select("id, store_id, sender_id, sender_role, body, created_at")
      .in("store_id", stores.map((store) => store.id))
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(Math.max(100, stores.length * 10))
      .then(({ data, error }) => {
        if (disposed) return;
        if (error) {
          setErrorMessage("Chưa tải được danh sách tin nhắn. Hãy kiểm tra migration 021 và quyền truy cập.");
          return;
        }
        const latest: Record<string, ChatMessage> = {};
        for (const message of (data ?? []) as ChatMessage[]) {
          if (!latest[message.store_id]) latest[message.store_id] = message;
        }
        setLatestByStore(latest);
      });
    return () => { disposed = true; };
  }, [stores, supabase]);

  useEffect(() => {
    if (!stores.length) {
      setConnection("idle");
      return;
    }
    const channel = supabase
      .channel("admin-store-conversations")
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "store_admin_messages",
      }, (payload) => {
        const message = payload.new as ChatMessage;
        setLatestByStore((current) => ({ ...current, [message.store_id]: message }));
        setMessages((current) => message.store_id === selectedStoreId ? mergeMessages(current, [message]) : current);
      })
      .subscribe((status) => {
        setConnection(status === "SUBSCRIBED" ? "connected" : status === "CHANNEL_ERROR" || status === "TIMED_OUT" ? "error" : "connecting");
      });
    return () => { void supabase.removeChannel(channel); };
  }, [selectedStoreId, stores, supabase]);

  useEffect(() => {
    if (!selectedStoreId) {
      setMessages([]);
      setIsLoading(false);
      return;
    }
    let disposed = false;
    setMessages([]);
    setIsLoading(true);
    setErrorMessage("");
    void supabase
      .from("store_admin_messages")
      .select("id, store_id, sender_id, sender_role, body, created_at")
      .eq("store_id", selectedStoreId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (disposed) return;
        if (error) setErrorMessage("Chưa tải được cuộc trò chuyện. Hãy kiểm tra migration 021 và quyền truy cập.");
        setMessages((current) => mergeMessages(current, ((data ?? []) as ChatMessage[]).reverse()));
        setIsLoading(false);
      });
    return () => { disposed = true; };
  }, [selectedStoreId, supabase]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, selectedStoreId]);

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
      const sent = data as ChatMessage;
      setMessages((current) => mergeMessages(current, [sent]));
      setLatestByStore((current) => ({ ...current, [sent.store_id]: sent }));
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

  const visibleStores = stores
    .filter((store) => `${store.name} ${latestByStore[store.id]?.body ?? ""}`.toLocaleLowerCase("vi-VN").includes(search.trim().toLocaleLowerCase("vi-VN")))
    .sort((a, b) => (latestByStore[b.id]?.created_at ?? "").localeCompare(latestByStore[a.id]?.created_at ?? "") || a.name.localeCompare(b.name, "vi"));

  return (
    <main className="admin-messages-page">
      <div className="admin-messages-heading">
        <div className="admin-messages-heading-icon" aria-hidden="true">✉</div>
        <div><p className="dashboard-kicker">HỖ TRỢ CỬA HÀNG</p><h1 className="admin-page-title">Tin nhắn</h1><p className="dashboard-intro">Trao đổi trực tiếp với chủ cửa hàng.</p></div>
        <div className={`admin-messages-connection is-${connection}`}><span />{connection === "connected" ? "Đã kết nối" : connection === "error" ? "Mất kết nối" : "Đang kết nối"}</div>
      </div>

      <section className={`admin-messages-layout${isMobileThreadOpen ? " is-thread-open" : ""}`} aria-label="Tin nhắn với cửa hàng">
        <aside className="admin-messages-list">
          <div className="admin-messages-list-header"><div><h2>Cuộc trò chuyện</h2><span>{stores.length} cửa hàng</span></div></div>
          <label className="admin-messages-search"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm cửa hàng..." aria-label="Tìm cửa hàng" /></label>
          <div className="admin-messages-store-list">
            {visibleStores.map((store) => {
              const latest = latestByStore[store.id];
              const selected = store.id === selectedStoreId;
              return <button className={`admin-messages-store${selected ? " is-selected" : ""}`} type="button" key={store.id} onClick={() => { setSelectedStoreId(store.id); setIsMobileThreadOpen(true); }} aria-pressed={selected}>
                <span className="admin-messages-store-avatar">{store.name.trim().charAt(0).toLocaleUpperCase("vi-VN") || "C"}</span>
                <span className="admin-messages-store-copy"><b>{store.name}</b><small>{latest ? `${latest.sender_role === "admin" ? "Bạn: " : ""}${latest.body}` : "Bắt đầu cuộc trò chuyện"}</small></span>
                <span className="admin-messages-store-meta">
                  {latest && <span className="admin-messages-store-time">{formatTime(latest.created_at, true)}</span>}
                  {(unreadByStore[store.id] ?? 0) > 0 && <span className="admin-messages-store-unread">{unreadByStore[store.id] > 99 ? "99+" : unreadByStore[store.id]}</span>}
                </span>
              </button>;
            })}
            {visibleStores.length === 0 && <p className="admin-messages-list-empty">Không tìm thấy cửa hàng phù hợp.</p>}
          </div>
        </aside>

        <section className="admin-messages-thread" aria-label={activeStore ? `Cuộc trò chuyện với ${activeStore.name}` : "Chọn cửa hàng"}>
          {activeStore ? <>
            <header className="admin-messages-thread-header">
              <button className="admin-messages-back" type="button" onClick={() => setIsMobileThreadOpen(false)} aria-label="Quay lại danh sách">←</button>
              <span className="admin-messages-store-avatar">{activeStore.name.trim().charAt(0).toLocaleUpperCase("vi-VN") || "C"}</span>
              <div><h2>{activeStore.name}</h2><p>/{activeStore.slug} <span>·</span> Hỗ trợ cửa hàng</p></div>
              <span className={`admin-messages-thread-status is-${connection}`}><i />{connection === "connected" ? "Trực tuyến" : connection === "error" ? "Mất kết nối" : "Đang kết nối"}</span>
            </header>
            <div className="admin-messages-history" aria-live="polite" aria-relevant="additions text">
              <div className="admin-messages-day-label"><span>Trao đổi với {activeStore.name}</span></div>
              {isLoading && <p className="admin-messages-loading">Đang tải tin nhắn…</p>}
              {!isLoading && messages.length === 0 && <div className="admin-messages-empty"><span>✉</span><b>Chưa có tin nhắn</b><p>Gửi lời chào để bắt đầu trao đổi với cửa hàng này.</p></div>}
              {messages.map((message) => {
                const ownMessage = message.sender_role === "admin";
                return <article key={message.id} className={`admin-message-bubble${ownMessage ? " is-own" : ""}`}>
                  {!ownMessage && <small>{activeStore.name}</small>}
                  <p>{message.body}</p><time dateTime={message.created_at}>{formatTime(message.created_at)}</time>
                </article>;
              })}
              <div ref={endRef} />
            </div>
            {errorMessage && <p className="admin-messages-error" role="alert">{errorMessage}</p>}
            <form className="admin-messages-compose" onSubmit={sendMessage}>
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={submitOnEnter} rows={2} maxLength={2000} placeholder={`Nhắn tin cho ${activeStore.name}...`} aria-label="Nội dung tin nhắn" disabled={isSending} />
              <div><span>Enter để gửi · Shift + Enter để xuống dòng</span><button type="submit" disabled={!draft.trim() || isSending}>{isSending ? "Đang gửi…" : "Gửi tin nhắn　➤"}</button></div>
            </form>
          </> : <div className="admin-messages-empty"><span>✉</span><b>Chọn một cửa hàng</b><p>Chọn cuộc trò chuyện bên trái để bắt đầu nhắn tin.</p></div>}
        </section>
      </section>
    </main>
  );
}
