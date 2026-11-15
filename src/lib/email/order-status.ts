import "server-only";
import nodemailer from "nodemailer";

export type OrderStatusNotice =
  | "confirmed"
  | "rejected"
  | "ready"
  | "out_for_delivery"
  | "completed"
  | "cancelled"
  | "payment_confirmed";

type OrderNoticeDetails = {
  customerEmail: string | null;
  customerName: string;
  storeName: string;
  publicCode: string;
  totalVnd: number;
  fulfillment: "pickup" | "delivery";
};

const notices: Record<OrderStatusNotice, { subject: string; title: string; message: (details: OrderNoticeDetails) => string }> = {
  confirmed: {
    subject: "Cửa hàng đã xác nhận đơn hàng",
    title: "Đơn hàng đã được xác nhận",
    message: ({ storeName }) => `${storeName} đã xác nhận và sẽ bắt đầu chuẩn bị đơn hàng của bạn.`,
  },
  rejected: {
    subject: "Cửa hàng chưa thể nhận đơn hàng",
    title: "Cửa hàng chưa thể nhận đơn",
    message: ({ storeName }) => `${storeName} hiện chưa thể nhận đơn hàng này. Vui lòng liên hệ cửa hàng nếu bạn cần hỗ trợ.`,
  },
  ready: {
    subject: "Đơn hàng đã sẵn sàng",
    title: "Đơn hàng đã sẵn sàng",
    message: ({ storeName, fulfillment }) => fulfillment === "delivery"
      ? `${storeName} đã chuẩn bị xong đơn hàng và sẽ sớm giao cho bạn.`
      : `${storeName} đã chuẩn bị xong. Bạn có thể đến cửa hàng nhận món.`,
  },
  out_for_delivery: {
    subject: "Đơn hàng đang được giao",
    title: "Đơn hàng đang trên đường đến",
    message: ({ storeName }) => `${storeName} đã bắt đầu giao đơn hàng đến địa chỉ của bạn.`,
  },
  completed: {
    subject: "Đơn hàng đã hoàn tất",
    title: "Đơn hàng đã hoàn tất",
    message: ({ storeName }) => `Đơn hàng từ ${storeName} đã được hoàn tất. Cảm ơn bạn đã đặt món!`,
  },
  cancelled: {
    subject: "Đơn hàng đã được hủy",
    title: "Đơn hàng đã được hủy",
    message: ({ storeName }) => `Đơn hàng tại ${storeName} đã được hủy. Vui lòng liên hệ cửa hàng nếu bạn cần hỗ trợ.`,
  },
  payment_confirmed: {
    subject: "Cửa hàng đã xác nhận thanh toán",
    title: "Thanh toán đã được xác nhận",
    message: ({ storeName }) => `${storeName} đã xác nhận nhận được khoản thanh toán cho đơn hàng của bạn.`,
  },
};

function escapeHtml(value: string) {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => entities[character] ?? character);
}

function formatPrice(value: number) {
  return `${value.toLocaleString("vi-VN")}₫`;
}

export async function sendOrderStatusNotice(
  details: OrderNoticeDetails,
  noticeType: OrderStatusNotice,
) {
  const gmailUser = process.env.GMAIL_USER?.trim();
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");
  if (!gmailUser || !gmailAppPassword || !details.customerEmail) return false;

  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";
    const trackingUrl = new URL("/track-order", appUrl).toString();
    const notice = notices[noticeType];
    const customerName = escapeHtml(details.customerName);
    const storeName = escapeHtml(details.storeName);
    const publicCode = escapeHtml(details.publicCode);
    const message = escapeHtml(notice.message(details));
    const total = formatPrice(details.totalVnd);
    const safeTrackingUrl = escapeHtml(trackingUrl);
    const html = `
      <div style="margin:0;padding:32px 12px;background:#f6f9f4;font-family:Arial,sans-serif;color:#245c37">
        <div style="max-width:560px;margin:0 auto;padding:30px;border:1px solid #e2e9e0;border-radius:16px;background:#ffffff">
          <p style="margin:0 0 10px;color:#2f8045;font-size:12px;font-weight:bold;letter-spacing:1px">CẬP NHẬT ĐƠN HÀNG</p>
          <h1 style="margin:0 0 12px;font-size:24px">${notice.title}</h1>
          <p style="margin:0 0 22px;color:#687166;line-height:1.6">Xin chào ${customerName}, ${message}</p>
          <div style="padding:18px;border-radius:12px;background:#f2f7f0">
            <p style="margin:0 0 8px;color:#7a8178;font-size:12px">MÃ ĐƠN HÀNG</p>
            <p style="margin:0;color:#245c37;font-size:22px;font-weight:bold;letter-spacing:1px">${publicCode}</p>
            <p style="margin:12px 0 0;color:#52604f">Tổng tiền: <strong>${total}</strong></p>
          </div>
          <p style="margin:22px 0 14px;color:#687166;line-height:1.6">Bạn có thể tra cứu trạng thái đơn hàng bằng mã đơn và số điện thoại đã đặt.</p>
          <a href="${safeTrackingUrl}" style="display:inline-block;padding:12px 18px;border-radius:9px;background:#2f8045;color:#ffffff;font-weight:bold;text-decoration:none">Tra cứu đơn hàng</a>
          <p style="margin:26px 0 0;color:#92988e;font-size:12px">Email tự động từ cửa hàng ${storeName}.</p>
        </div>
      </div>`;
    const text = [
      `Xin chào ${details.customerName},`,
      notice.message(details),
      `Mã đơn hàng: ${details.publicCode}`,
      `Tổng tiền: ${total}`,
      `Tra cứu đơn hàng: ${trackingUrl}`,
      "Dùng mã đơn và số điện thoại đã đặt để tra cứu.",
    ].join("\n\n");

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailAppPassword },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    await transporter.sendMail({
      from: { name: "FoodGo", address: gmailUser },
      to: details.customerEmail,
      subject: `${notice.subject} · ${details.publicCode}`,
      html,
      text,
    });
    return true;
  } catch {
    return false;
  }
}
