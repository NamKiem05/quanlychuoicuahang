import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { date, money, orderStatus, paymentStatus, type CustomerOrderDetail } from "../order-display";
import "../orders.css";

export const metadata = { title: "Chi tiết đơn hàng | GrowDesk" };
export const instant = false;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CustomerOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (!uuid.test(orderId)) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=customer-orders");
  const { data, error } = await supabase.rpc("customer_order_detail", { requested_order: orderId });
  if (error) return <main className="customer-orders-page"><section className="customer-orders-content"><div className="customer-orders-empty" role="alert"><h1>Chưa tải được đơn hàng</h1><p>Vui lòng thử lại sau.</p><Link href="/customer/orders">← Đơn hàng của tôi</Link></div></section></main>;
  if (!data) notFound();
  const order = data as CustomerOrderDetail;
  const fulfillment = order.fulfillment === "delivery" ? "Giao hàng" : "Nhận tại cửa hàng";
  const payment = order.payment_method === "bank_transfer" ? "Chuyển khoản" : order.fulfillment === "delivery" ? "Tiền mặt khi nhận hàng" : "Tiền mặt tại cửa hàng";
  return <main className="customer-orders-page"><header className="customer-orders-top"><Link href="/">GrowDesk</Link><Link href="/customer/orders">← Đơn hàng của tôi</Link></header><section className="customer-orders-content"><div className="customer-orders-heading"><div><span>CHI TIẾT ĐƠN HÀNG</span><h1>{order.public_code}</h1><p>Đặt tại {order.store_name} · {date(order.created_at)}</p></div><span className={`customer-order-status status-${order.status}`}>{orderStatus(order.status)}</span></div><div className="customer-order-detail-grid"><div><section className="customer-order-panel"><h2>Sản phẩm đã đặt</h2>{order.items.map(item => <div className="customer-order-item" key={item.id}><div><b>{item.name}</b>{item.sku && <small>SKU: {item.sku}</small>}<small>{money(item.unit_price_vnd)} × {item.quantity}</small></div><strong>{money(item.unit_price_vnd * item.quantity)}</strong></div>)}</section><section className="customer-order-panel"><h2>Thông tin nhận hàng</h2><dl><div><dt>Người nhận</dt><dd>{order.customer_name}</dd></div><div><dt>Số điện thoại</dt><dd>{order.customer_phone}</dd></div><div><dt>Hình thức</dt><dd>{fulfillment}</dd></div>{order.delivery_address && <div><dt>Địa chỉ</dt><dd>{order.delivery_address}</dd></div>}{order.customer_note && <div><dt>Ghi chú</dt><dd>{order.customer_note}</dd></div>}</dl></section></div><aside><section className="customer-order-panel"><h2>Thanh toán</h2><dl><div><dt>Phương thức</dt><dd>{payment}</dd></div><div><dt>Trạng thái</dt><dd>{paymentStatus(order.payment_status)}</dd></div><div><dt>Tạm tính</dt><dd>{money(order.subtotal_vnd)}</dd></div><div><dt>Phí giao hàng</dt><dd>{money(order.delivery_fee_vnd)}</dd></div>{Number(order.discount_vnd) > 0 && <div><dt>Giảm giá{order.promotion_code ? ` · ${order.promotion_code}` : ""}</dt><dd>−{money(order.discount_vnd)}</dd></div>}<div className="customer-order-total"><dt>Tổng cộng</dt><dd>{money(order.total_vnd)}</dd></div>{order.refund_amount_vnd != null && <div><dt>Đã hoàn tiền</dt><dd>{money(order.refund_amount_vnd)}</dd></div>}</dl>{order.cancellation_request_status === "pending" && <p>Yêu cầu hủy đang chờ cửa hàng xử lý.</p>}<Link className="customer-order-track" href="/track-order">Tra cứu và theo dõi đơn →</Link></section></aside></div></section></main>;
}
