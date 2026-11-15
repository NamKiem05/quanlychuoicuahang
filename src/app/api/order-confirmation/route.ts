import { createClient } from "@/lib/supabase/server";
import nodemailer from "nodemailer";

type ConfirmationDetails = {
  customer_email: string;
  customer_name: string;
  store_name: string;
  total_vnd: number;
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

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== new URL(request.url).origin) {
        return Response.json({ sent: false, reason: "invalid_origin" }, { status: 403 });
      }
    } catch {
      return Response.json({ sent: false, reason: "invalid_origin" }, { status: 403 });
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ sent: false, reason: "invalid_request" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return Response.json({ sent: false, reason: "invalid_request" }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const publicCode = typeof input.publicCode === "string" ? input.publicCode.trim().toUpperCase() : "";
  const customerPhone = typeof input.customerPhone === "string" ? input.customerPhone.trim() : "";
  const phoneDigits = customerPhone.replace(/\D/g, "");

  if (!/^MO-[A-F0-9]{24}$/.test(publicCode) || phoneDigits.length < 9 || phoneDigits.length > 16) {
    return Response.json({ sent: false, reason: "invalid_request" }, { status: 400 });
  }

  const gmailUser = process.env.GMAIL_USER?.trim();
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");
  if (!gmailUser || !gmailAppPassword) {
    return Response.json({ sent: false, reason: "not_configured" });
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_order_confirmation_details", {
      requested_public_code: publicCode,
      requested_customer_phone: customerPhone,
    });

    if (error || !data) {
      return Response.json({ sent: false, reason: "order_not_found" }, { status: 404 });
    }

    const details = data as ConfirmationDetails;
    const customerName = escapeHtml(details.customer_name);
    const storeName = escapeHtml(details.store_name);
    const code = escapeHtml(publicCode);
    const price = formatPrice(Number(details.total_vnd));
    const trackingUrl = new URL("/track-order", request.url).toString();
    const html = `
      <div style="margin:0;padding:32px 12px;background:#f6f9f4;font-family:Arial,sans-serif;color:#245c37">
        <div style="max-width:560px;margin:0 auto;padding:30px;border:1px solid #e2e9e0;border-radius:16px;background:#ffffff">
          <p style="margin:0 0 10px;color:#2f8045;font-size:12px;font-weight:bold;letter-spacing:1px">BẾP NHÀ MƠ · XÁC NHẬN ĐƠN</p>
          <h1 style="margin:0 0 12px;font-size:24px">Cảm ơn ${customerName} đã đặt món!</h1>
          <p style="margin:0 0 22px;color:#687166;line-height:1.6">${storeName} đã nhận được đơn hàng của bạn.</p>
          <div style="padding:18px;border-radius:12px;background:#f2f7f0">
            <p style="margin:0 0 8px;color:#7a8178;font-size:12px">MÃ ĐƠN HÀNG</p>
            <p style="margin:0;color:#245c37;font-size:22px;font-weight:bold;letter-spacing:1px">${code}</p>
            <p style="margin:12px 0 0;color:#52604f">Tổng tiền: <strong>${price}</strong></p>
          </div>
          <p style="margin:22px 0 14px;color:#687166;line-height:1.6">Hãy giữ lại mã đơn và số điện thoại đã đặt để tra cứu tình trạng đơn hàng.</p>
          <a href="${trackingUrl}" style="display:inline-block;padding:12px 18px;border-radius:9px;background:#2f8045;color:#ffffff;font-weight:bold;text-decoration:none">Tra cứu đơn hàng</a>
          <p style="margin:26px 0 0;color:#92988e;font-size:12px">Nếu bạn không đặt đơn này, vui lòng bỏ qua email.</p>
        </div>
      </div>`;
    const text = [
      `Cảm ơn ${details.customer_name} đã đặt món tại ${details.store_name}.`,
      `Mã đơn hàng: ${publicCode}`,
      `Tổng tiền: ${price}`,
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
      from: { name: "Bếp Nhà Mơ", address: gmailUser },
      to: details.customer_email,
      subject: `Mã đơn hàng ${publicCode} · Bếp Nhà Mơ`,
      html,
      text,
    });

    return Response.json({ sent: true });
  } catch {
    return Response.json({ sent: false, reason: "send_failed" }, { status: 502 });
  }
}
