import { createClient } from "@/lib/supabase/server";
import { applicationMailer } from "@/lib/email/smtp";

type ConfirmationDetails = {
  customer_email: string;
  customer_name: string;
  store_name: string;
  is_retail?: boolean;
  total_vnd: number;
  promotion_code?: string | null;
  discount_vnd?: number;
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
    const discountVnd = Number(details.discount_vnd ?? 0);
    const promotionCode = details.promotion_code ? escapeHtml(details.promotion_code) : "";
    const isRetail = details.is_retail === true;
    const trackingUrl = new URL(isRetail ? "/customer/orders" : "/track-order", request.url).toString();
    const orderLinkLabel = isRetail ? "Xem đơn hàng của tôi" : "Tra cứu đơn hàng";
    const instructions = isRetail ? "Đăng nhập vào tài khoản mua hàng để xem tình trạng đơn." : "Hãy giữ lại mã đơn và số điện thoại đã đặt để tra cứu tình trạng đơn hàng.";
    const html = `
      <div style="margin:0;padding:32px 12px;background:#f6f9f4;font-family:Arial,sans-serif;color:#245c37">
        <div style="max-width:560px;margin:0 auto;padding:30px;border:1px solid #e2e9e0;border-radius:16px;background:#ffffff">
          <p style="margin:0 0 10px;color:#2f8045;font-size:12px;font-weight:bold;letter-spacing:1px">${storeName} · XÁC NHẬN ĐƠN</p>
          <h1 style="margin:0 0 12px;font-size:24px">Cảm ơn ${customerName} đã ${isRetail ? "đặt hàng" : "đặt món"}!</h1>
          <p style="margin:0 0 22px;color:#687166;line-height:1.6">${storeName} đã nhận được đơn hàng của bạn.</p>
          <div style="padding:18px;border-radius:12px;background:#f2f7f0">
            <p style="margin:0 0 8px;color:#7a8178;font-size:12px">MÃ ĐƠN HÀNG</p>
            <p style="margin:0;color:#245c37;font-size:22px;font-weight:bold;letter-spacing:1px">${code}</p>
            ${discountVnd > 0 ? `<p style="margin:12px 0 0;color:#52604f">Mã ${promotionCode}: giảm <strong>${formatPrice(discountVnd)}</strong></p>` : ""}
            <p style="margin:12px 0 0;color:#52604f">Tổng tiền: <strong>${price}</strong></p>
          </div>
          <p style="margin:22px 0 14px;color:#687166;line-height:1.6">${instructions}</p>
          <a href="${trackingUrl}" style="display:inline-block;padding:12px 18px;border-radius:9px;background:#2f8045;color:#ffffff;font-weight:bold;text-decoration:none">${orderLinkLabel}</a>
          <p style="margin:26px 0 0;color:#92988e;font-size:12px">Nếu bạn không đặt đơn này, vui lòng bỏ qua email.</p>
        </div>
      </div>`;
    const text = [
      `Cảm ơn ${details.customer_name} đã ${isRetail ? "đặt hàng" : "đặt món"} tại ${details.store_name}.`,
      `Mã đơn hàng: ${publicCode}`,
      ...(discountVnd > 0 ? [`Mã khuyến mãi ${details.promotion_code}: giảm ${formatPrice(discountVnd)}`] : []),
      `Tổng tiền: ${price}`,
      `${orderLinkLabel}: ${trackingUrl}`,
      instructions,
    ].join("\n\n");

    const { transporter, from } = await applicationMailer();
    await transporter.sendMail({
      from,
      to: details.customer_email,
      subject: `Mã đơn hàng ${publicCode} · ${details.store_name}`,
      html,
      text,
    });

    return Response.json({ sent: true });
  } catch {
    return Response.json({ sent: false, reason: "send_failed" }, { status: 502 });
  }
}
