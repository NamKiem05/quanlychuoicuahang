"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import BankTransferQr, { type BankTransferDetails } from "@/app/bank-transfer-qr";

type OrderItem = {
  order_item_id: string;
  name: string;
  quantity: number;
  unit_price_vnd: number;
  review_status: "pending" | "published" | "hidden" | null;
};
type TrackedOrder = {
  public_code: string;
  status: string;
  store_name: string;
  created_at: string;
  total_vnd: number;
  promotion_code: string | null;
  discount_vnd: number;
  fulfillment: "pickup" | "delivery";
  delivery_address: string | null;
  delivery_distance_m: number | null;
  delivery_fee_vnd: number;
  payment_method: "cash_on_pickup" | "cash_on_delivery" | "bank_transfer";
  payment_status: "unpaid" | "awaiting_payment" | "paid";
  payment_reference: string | null;
  payment_bank_code: string | null;
  payment_bank_name: string | null;
  payment_account_number: string | null;
  payment_account_name: string | null;
  cancellation_request_status: "none" | "pending" | "approved" | "declined";
  cancellation_request_reason: string | null;
  cancellation_requested_at: string | null;
  cancellation_decided_at: string | null;
  items: OrderItem[];
};

const statusLabels: Record<string, string> = {
  pending: "Chờ cửa hàng xác nhận",
  confirmed: "Cửa hàng đã nhận đơn",
  preparing: "Đang chuẩn bị món",
  ready: "Đơn đã sẵn sàng để nhận",
  out_for_delivery: "Đang giao đến bạn",
  completed: "Đơn đã hoàn tất",
  cancelled: "Đơn đã hủy",
  rejected: "Cửa hàng không thể nhận đơn",
};

const formatPrice = (price: number) => `${Number(price).toLocaleString("vi-VN")}₫`;
const isClosedOrder = (status: string) => status === "cancelled" || status === "rejected";

function paymentStatusLabel(order: TrackedOrder) {
  if (order.payment_status === "paid") return isClosedOrder(order.status) ? "Đã nhận tiền · đơn đã đóng" : "Đã xác nhận";
  return isClosedOrder(order.status) ? "Đơn đã đóng" : "Đang chờ xác nhận chuyển khoản";
}

export default function TrackOrderForm() {
  const supabase = useMemo(() => createClient(), []);
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [reviewMessages, setReviewMessages] = useState<Record<string, string>>({});
  const [reviewErrors, setReviewErrors] = useState<Record<string, string>>({});
  const [submittingReviewId, setSubmittingReviewId] = useState<string | null>(null);
  const [trackedPhone, setTrackedPhone] = useState("");
  const [isSubmittingCancellation, setIsSubmittingCancellation] = useState(false);
  const [cancellationError, setCancellationError] = useState("");
  const shouldAutoRefresh = Boolean(order && !isClosedOrder(order.status) && (
    order.status !== "completed" || (order.payment_method === "bank_transfer" && order.payment_status !== "paid")
  ));
  const trackedOrderCode = order?.public_code ?? "";

  useEffect(() => {
    if (!trackedOrderCode || !trackedPhone || !shouldAutoRefresh) return;

    let disposed = false;
    let requestInFlight = false;
    const refreshOrder = async () => {
      if (disposed || requestInFlight || document.visibilityState !== "visible") return;
      requestInFlight = true;
      try {
        const { data, error } = await supabase.rpc("track_guest_order", {
          requested_public_code: trackedOrderCode,
          requested_customer_phone: trackedPhone,
        });
        if (disposed || error || !data) return;

        const refreshedOrder = data as TrackedOrder;
        setOrder((current) => {
          if (!current || current.public_code !== refreshedOrder.public_code) return current;
          const changed = current.status !== refreshedOrder.status
            || current.payment_status !== refreshedOrder.payment_status
            || current.cancellation_request_status !== refreshedOrder.cancellation_request_status
            || current.cancellation_request_reason !== refreshedOrder.cancellation_request_reason
            || current.cancellation_decided_at !== refreshedOrder.cancellation_decided_at
            || current.items.length !== refreshedOrder.items.length
            || current.items.some((item, index) => item.review_status !== refreshedOrder.items[index]?.review_status);
          return changed ? refreshedOrder : current;
        });
      } catch {
        // Keep showing the last successful result and retry on the next interval.
      } finally {
        requestInFlight = false;
      }
    };

    const intervalId = window.setInterval(() => void refreshOrder(), 10_000);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [shouldAutoRefresh, supabase, trackedOrderCode, trackedPhone]);

  async function findOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOrder(null);
    setErrorMessage("");
    setReviewMessages({});
    setReviewErrors({});
    setCancellationError("");
    setTrackedPhone("");
    setIsSearching(true);
    const formData = new FormData(event.currentTarget);
    try {
      const { data, error } = await supabase.rpc("track_guest_order", {
        requested_public_code: String(formData.get("publicCode") ?? "").trim(),
        requested_customer_phone: String(formData.get("customerPhone") ?? "").trim(),
      });

      if (error || !data) {
        setErrorMessage("Không tìm thấy đơn với mã đơn và số điện thoại này.");
        return;
      }
      setTrackedPhone(String(formData.get("customerPhone") ?? "").trim());
      setOrder(data as TrackedOrder);
    } catch {
      setErrorMessage("Không tìm thấy đơn với mã đơn và số điện thoại này.");
    } finally {
      setIsSearching(false);
    }
  }

  async function submitReview(event: FormEvent<HTMLFormElement>, item: OrderItem) {
    event.preventDefault();
    setReviewErrors((current) => ({ ...current, [item.order_item_id]: "" }));
    setSubmittingReviewId(item.order_item_id);
    const formData = new FormData(event.currentTarget);

    try {
      const { error } = await supabase.rpc("create_guest_review", {
        requested_public_code: order?.public_code ?? "",
        requested_customer_phone: String(formData.get("customerPhone") ?? ""),
        requested_order_item_id: item.order_item_id,
        requested_rating: Number(formData.get("rating")),
        requested_body: String(formData.get("body") ?? "").trim(),
      });

      if (error) {
        setReviewErrors((current) => ({ ...current, [item.order_item_id]: "Chưa gửi được đánh giá. Hãy tải lại đơn rồi thử lại." }));
        return;
      }

      setOrder((current) => current ? {
        ...current,
        items: current.items.map((currentItem) => currentItem.order_item_id === item.order_item_id
          ? { ...currentItem, review_status: "pending" }
          : currentItem),
      } : current);
      setReviewMessages((current) => ({ ...current, [item.order_item_id]: "Đánh giá đã gửi và đang chờ cửa hàng duyệt." }));
    } catch {
      setReviewErrors((current) => ({ ...current, [item.order_item_id]: "Chưa gửi được đánh giá. Hãy tải lại đơn rồi thử lại." }));
    } finally {
      setSubmittingReviewId(null);
    }
  }

  async function requestCancellation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCancellationError("");
    if (!order || !trackedPhone) return;

    setIsSubmittingCancellation(true);
    const formData = new FormData(event.currentTarget);
    try {
      const { data, error } = await supabase.rpc("request_guest_order_cancellation", {
        requested_public_code: order.public_code,
        requested_customer_phone: trackedPhone,
        requested_reason: String(formData.get("reason") ?? "").trim(),
      });
      const response = data as { status?: string; reason?: string | null; requested_at?: string | null } | null;

      if (error || response?.status !== "pending") {
        const detail = error?.message ?? "";
        setCancellationError(detail.includes("cancellation unavailable")
          ? "Đơn không còn ở trạng thái có thể gửi yêu cầu hủy."
          : detail.includes("already decided")
            ? "Yêu cầu hủy đơn này đã được cửa hàng xử lý."
            : "Chưa gửi được yêu cầu hủy. Hãy tải lại đơn rồi thử lại.");
        return;
      }

      setOrder((current) => current ? {
        ...current,
        cancellation_request_status: "pending",
        cancellation_request_reason: response.reason ?? String(formData.get("reason") ?? "").trim(),
        cancellation_requested_at: response.requested_at ?? new Date().toISOString(),
        cancellation_decided_at: null,
      } : current);
    } catch {
      setCancellationError("Chưa gửi được yêu cầu hủy. Hãy tải lại đơn rồi thử lại.");
    } finally {
      setIsSubmittingCancellation(false);
    }
  }

  return (
    <div className="tracking-content">
      <div className="eyebrow"><span>✳</span> ĐƠN HÀNG CỦA BẠN</div>
      <h1>Tra cứu đơn hàng</h1>
      <p className="tracking-intro">Nhập mã đơn và số điện thoại đã dùng khi đặt món.</p>

      <form className="tracking-form" onSubmit={findOrder}>
        <label>Mã đơn<input name="publicCode" autoComplete="off" placeholder="Ví dụ: MO-A1B2C3..." required /></label>
        <label>Số điện thoại<input name="customerPhone" type="tel" inputMode="tel" autoComplete="tel" pattern="[0-9+() .-]{9,16}" placeholder="Số điện thoại đặt hàng" required /></label>
        {errorMessage && <p className="order-error" role="alert">{errorMessage}</p>}
        <button className="primary-button tracking-submit" type="submit" disabled={isSearching}>{isSearching ? "Đang tra cứu..." : "Tra cứu"}<span>→</span></button>
      </form>

      {order && (
        <section className="tracked-order" aria-live="polite">
          <header>
            <div><small>MÃ ĐƠN</small><b>{order.public_code}</b></div>
            <span className={`status-badge status-${order.status}`}>{order.status === "ready" && order.fulfillment === "delivery" ? "Đơn đã sẵn sàng giao" : statusLabels[order.status] ?? order.status}</span>
          </header>
          {shouldAutoRefresh && <p className="tracking-refresh-note"><span aria-hidden="true">●</span> Trạng thái tự cập nhật mỗi 10 giây khi trang đang mở.</p>}
          <p className="tracked-store">{order.store_name} · {new Date(order.created_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</p>
          {order.cancellation_request_status === "pending" && <div className="tracked-cancellation is-pending" role="status">
            <b>Đã gửi yêu cầu hủy đơn</b>
            {order.cancellation_request_reason && <span>Lý do: {order.cancellation_request_reason}</span>}
            <small>Cửa hàng đang xem xét yêu cầu của bạn.</small>
            {order.payment_method === "bank_transfer" && <small>Nếu bạn đã chuyển khoản, cửa hàng sẽ xử lý việc hoàn tiền thủ công sau khi quyết định.</small>}
          </div>}
          {order.cancellation_request_status === "approved" && <div className="tracked-cancellation is-approved" role="status">
            <b>Cửa hàng đã chấp nhận yêu cầu hủy</b>
            <span>Đơn hàng đã được đóng.</span>
            {order.payment_method === "bank_transfer" && <small>Nếu bạn đã chuyển khoản, vui lòng liên hệ cửa hàng để xác nhận việc hoàn tiền. Hệ thống không tự hoàn tiền.</small>}
          </div>}
          {order.cancellation_request_status === "declined" && <div className="tracked-cancellation is-declined" role="status">
            <b>Cửa hàng chưa chấp nhận yêu cầu hủy</b>
            <span>Liên hệ cửa hàng nếu bạn cần hỗ trợ thêm.</span>
          </div>}
          {cancellationError && <p className="order-error" role="alert">{cancellationError}</p>}
          {order.status === "pending" || order.status === "confirmed" ? order.cancellation_request_status === "none" && <form className="tracked-cancel-form" onSubmit={requestCancellation}>
            <label>Lý do yêu cầu hủy<textarea name="reason" rows={2} minLength={5} maxLength={500} required placeholder="Cho cửa hàng biết lý do bạn muốn hủy đơn" /></label>
            <button className="secondary-submit" type="submit" disabled={isSubmittingCancellation}>{isSubmittingCancellation ? "Đang gửi..." : "Gửi yêu cầu hủy đơn"}</button>
          </form> : null}
          {order.fulfillment === "delivery" && (
            <div className="tracked-delivery-summary">
              <b>Giao tận nơi</b>
              <span>{order.delivery_address}</span>
              <small>{order.delivery_distance_m == null ? "" : `${(Number(order.delivery_distance_m) / 1000).toFixed(1)} km từ cửa hàng`} · Phí giao {formatPrice(Number(order.delivery_fee_vnd))}</small>
            </div>
          )}
          <ul>
            {order.items.map((item) => (
              <li className="tracked-item" key={item.order_item_id}>
                <div className="tracked-item-row"><span>{item.name} × {item.quantity}</span><b>{formatPrice(item.unit_price_vnd * item.quantity)}</b></div>
                {order.status === "completed" && item.review_status === null && (
                  <form className="review-form" onSubmit={(event) => submitReview(event, item)}>
                    <label>Đánh giá món<select name="rating" defaultValue="5"><option value="5">★★★★★ · Rất ngon</option><option value="4">★★★★☆ · Ngon</option><option value="3">★★★☆☆ · Bình thường</option><option value="2">★★☆☆☆ · Chưa hài lòng</option><option value="1">★☆☆☆☆ · Không hài lòng</option></select></label>
                    <label>Chia sẻ trải nghiệm <span className="optional-label">Không bắt buộc</span><textarea name="body" rows={2} maxLength={1000} placeholder="Món ăn có hợp khẩu vị của bạn không?" /></label>
                    <input type="hidden" name="customerPhone" value={trackedPhone} />
                    {reviewErrors[item.order_item_id] && <p className="order-error" role="alert">{reviewErrors[item.order_item_id]}</p>}
                    <button className="secondary-submit review-submit" type="submit" disabled={submittingReviewId === item.order_item_id}>{submittingReviewId === item.order_item_id ? "Đang gửi..." : "Gửi đánh giá"}</button>
                  </form>
                )}
                {item.review_status && <p className="review-state">{reviewMessages[item.order_item_id] || (item.review_status === "published" ? "Đánh giá đã được đăng." : item.review_status === "pending" ? "Đánh giá đang chờ cửa hàng duyệt." : "Đánh giá đã gửi tới cửa hàng.")}</p>}
              </li>
            ))}
          </ul>
          {order.payment_method === "bank_transfer" && (
            <section className="tracked-payment" aria-live="polite">
              <div className="tracked-payment-heading">
                <div><small>THANH TOÁN</small><b>Chuyển khoản QR</b></div>
                <span className={order.payment_status === "paid" ? "payment-paid-badge" : "payment-pending-badge"}>
                  {paymentStatusLabel(order)}
                </span>
              </div>
              {order.payment_status !== "paid" && order.status !== "cancelled" && order.status !== "rejected"
                && order.payment_reference && order.payment_bank_code && order.payment_bank_name
                && order.payment_account_number && order.payment_account_name && (
                  <BankTransferQr details={{
                    bank_code: order.payment_bank_code,
                    bank_name: order.payment_bank_name,
                    account_number: order.payment_account_number,
                    account_name: order.payment_account_name,
                    amount: Number(order.total_vnd),
                    reference: order.payment_reference,
                  } satisfies BankTransferDetails} />
                )}
              {order.payment_status === "paid" && (isClosedOrder(order.status)
                ? <p className="payment-confirmed-note">Cửa hàng đã nhận tiền nhưng đơn đã đóng. Hãy liên hệ cửa hàng để trao đổi việc hoàn tiền.</p>
                : <p className="payment-confirmed-note">Cửa hàng đã xác nhận nhận được khoản chuyển cho đơn này.</p>)}
              {isClosedOrder(order.status) && order.payment_status !== "paid" && <p className="payment-confirmed-note">Đơn đã đóng. Vui lòng liên hệ cửa hàng nếu bạn đã chuyển khoản.</p>}
            </section>
          )}
          {Number(order.discount_vnd) > 0 && <div className="tracked-promotion"><span>Mã {order.promotion_code}</span><strong>−{formatPrice(Number(order.discount_vnd))}</strong></div>}
          <div className="tracked-total"><span>Tổng tiền</span><strong>{formatPrice(order.total_vnd)}</strong></div>
        </section>
      )}
      <Link className="back-home" href="/">← Về trang giới thiệu</Link>
    </div>
  );
}
