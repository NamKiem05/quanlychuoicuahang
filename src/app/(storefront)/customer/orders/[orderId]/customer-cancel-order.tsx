"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function CustomerCancelOrder({ publicCode, customerPhone }: { publicCode: string; customerPhone: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setPending(true);
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    if (reason.length < 5 || reason.length > 500) {
      setMessage("Lý do phải có từ 5 đến 500 ký tự.");
      setPending(false);
      return;
    }
    try {
      const { data, error } = await createClient().rpc("request_guest_order_cancellation", {
        requested_public_code: publicCode,
        requested_customer_phone: customerPhone,
        requested_reason: reason,
      });
      if (error || data?.status !== "pending") {
        setMessage("Chưa gửi được yêu cầu. Đơn có thể đã thay đổi trạng thái; hãy tải lại và thử lại.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setMessage("Chưa gửi được yêu cầu. Hãy kiểm tra kết nối và thử lại.");
    } finally {
      setPending(false);
    }
  }
  return <div className="customer-cancel-request">
    {!open ? <button type="button" onClick={() => setOpen(true)}>Yêu cầu hủy đơn</button> : <form onSubmit={submit}>
      <label>Lý do yêu cầu hủy<textarea name="reason" minLength={5} maxLength={500} rows={3} required placeholder="Nhập lý do để cửa hàng xem xét" /></label>
      {message && <p role="alert">{message}</p>}
      <div><button type="button" disabled={pending} onClick={() => { setOpen(false); setMessage(""); }}>Đóng</button><button type="submit" disabled={pending}>{pending ? "Đang gửi…" : "Gửi yêu cầu"}</button></div>
    </form>}
  </div>;
}
