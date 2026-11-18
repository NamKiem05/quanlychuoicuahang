"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import "./chat-attachment.css";

export type ChatAttachmentMessage = { id: string; store_id: string; sender_id: string | null; sender_role: "merchant" | "admin"; body: string; created_at: string; attachment_path?: string | null; attachment_name?: string | null };
const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain"];

export function ChatAttachment({ path, name }: { path: string; name: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [error, setError] = useState("");
  async function download() {
    setError("");
    const result = await supabase.storage.from("store-chat-files").createSignedUrl(path, 60, { download: name });
    if (!result.data?.signedUrl || result.error) { setError("Không tải được tệp."); return; }
    const link = document.createElement("a");
    link.href = result.data.signedUrl;
    link.rel = "noopener noreferrer";
    link.click();
  }
  return <div className="chat-file-link"><button type="button" onClick={() => void download()}>📎 {name} ↓</button>{error && <small role="alert">{error}</small>}</div>;
}

export function ChatFileUpload({ storeId, onSent }: { storeId: string; onSent: (message: ChatAttachmentMessage) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file || busy) return;
    const name = file.name.replace(/[\x00-\x1f\x7f/\\]/g, "").slice(0, 150).trim();
    if (!name || !allowed.includes(file.type) || file.size < 1 || file.size > 5 * 1024 * 1024) { setError("Chọn ảnh JPEG, PNG, WebP, PDF hoặc văn bản tối đa 5 MB."); return; }
    setBusy(true); setError("");
    if (!globalThis.crypto?.randomUUID) { setError("Trình duyệt không hỗ trợ tạo mã tải tệp an toàn."); setBusy(false); return; }
    const path = `${storeId}/${crypto.randomUUID()}`;
    try {
      const sent = await supabase.storage.from("store-chat-files").upload(path, file, { contentType: file.type, upsert: false });
      if (sent.error) throw sent.error;
      const result = await supabase.rpc("send_store_chat_attachment", { target_store: storeId, path, filename: name });
      if (result.error || !result.data) { await supabase.storage.from("store-chat-files").remove([path]); throw result.error ?? new Error("Không lưu được tin nhắn"); }
      onSent(result.data as ChatAttachmentMessage);
    } catch { setError("Không gửi được tệp. Kiểm tra kết nối và cấu hình kho tệp."); }
    finally { setBusy(false); }
  }
  return <div className="chat-file-upload"><label>{busy ? "Đang tải tệp…" : "📎 Gửi tệp"}<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf,text/plain" disabled={busy} onChange={(event) => void upload(event)} /></label>{error && <small role="alert">{error}</small>}</div>;
}
