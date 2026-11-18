import { notFound, redirect } from "next/navigation";
import { getMerchantContext, formatPrice } from "../../../data";
import PrintButton from "../../print/print-button";
import "../../print/print.css";

export default async function OrderDocument({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ type?: string }> }) {
  const [{ orderId }, query, { supabase, store }] = await Promise.all([params, searchParams, getMerchantContext()]);
  if (!store) redirect("/dashboard");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId) || !["invoice", "packing"].includes(query.type ?? "")) notFound();
  const [{ data: order, error }, items] = await Promise.all([
    supabase.from("orders").select("id, public_code, customer_name, customer_phone, customer_note, fulfillment, delivery_address, payment_method, payment_status, subtotal_vnd, discount_vnd, delivery_fee_vnd, total_vnd, created_at").eq("store_id", store.id).eq("id", orderId).maybeSingle(),
    supabase.from("order_items").select("id, product_name_snapshot, quantity, unit_price_snapshot_vnd").eq("store_id", store.id).eq("order_id", orderId).order("id"),
  ]);
  if (error || items.error) return <main className="orders-print"><h1>Không tải được chứng từ</h1><p>Vui lòng thử lại.</p></main>;
  if (!order) notFound();
  const invoice = query.type === "invoice";
  const method: Record<string, string> = { cash_on_pickup: "Tiền mặt tại cửa hàng", cash_on_delivery: "Tiền mặt khi nhận hàng", bank_transfer: "Chuyển khoản" };
  const payment: Record<string, string> = { unpaid: "Chưa thanh toán", awaiting_payment: "Chờ xác nhận", paid: "Đã thanh toán" };
  return <main className="orders-print order-document"><div className="orders-print-actions"><PrintButton /></div><h1>{invoice ? "Hóa đơn bán hàng" : "Phiếu đóng gói"}</h1><p>{store.name} · Mã đơn: <b>{order.public_code}</b><br />Ngày đặt: {new Date(order.created_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</p><p><b>Khách hàng:</b> {order.customer_name} · {order.customer_phone}<br /><b>Nhận hàng:</b> {order.fulfillment === "delivery" ? order.delivery_address || "Chưa có địa chỉ" : "Nhận tại cửa hàng"}<br /><b>Ghi chú:</b> {order.customer_note || "Không có"}</p><table><thead><tr><th>Sản phẩm</th><th>Số lượng</th>{invoice && <><th>Đơn giá</th><th>Thành tiền</th></>}</tr></thead><tbody>{items.data?.map((item) => <tr key={item.id}><td>{item.product_name_snapshot}</td><td>{item.quantity}</td>{invoice && <><td>{formatPrice(Number(item.unit_price_snapshot_vnd))}</td><td>{formatPrice(Number(item.unit_price_snapshot_vnd) * item.quantity)}</td></>}</tr>)}</tbody></table>{!items.data?.length && <p>Không có thông tin sản phẩm.</p>}{invoice && <div className="order-document-totals"><p>Tiền sản phẩm: {formatPrice(Number(order.subtotal_vnd))}<br />Giảm giá: {formatPrice(Number(order.discount_vnd))}<br />Phí vận chuyển: {formatPrice(Number(order.delivery_fee_vnd))}<br /><b>Tổng thanh toán: {formatPrice(Number(order.total_vnd))}</b></p><p>Thanh toán: {method[order.payment_method] ?? order.payment_method} · {payment[order.payment_status] ?? order.payment_status}</p><small>Chứng từ bán hàng do cửa hàng in, không phải hóa đơn điện tử thuế.</small></div>}</main>;
}
