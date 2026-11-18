import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import SidebarIcon from "@/app/sidebar-icon";
import CustomerCancelOrder from "./customer-cancel-order";
import { createClient } from "@/lib/supabase/server";
import { date, money, orderStatus, paymentStatus, type CustomerOrderDetail } from "../order-display";
import "../orders.css";
import "./order-detail.css";

export const metadata = { title: "Chi tiết đơn hàng | GrowDesk" };
export const instant = false;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CustomerOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  await connection();
  const { orderId } = await params;
  if (!uuid.test(orderId)) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=customer-orders");
  const { data, error } = await supabase.rpc("customer_order_detail", { requested_order: orderId });
  if (error) return <section className="customer-orders-content"><div className="customer-orders-empty" role="alert"><h1>Chưa tải được đơn hàng</h1><p>Vui lòng thử lại sau.</p><Link href="/customer/orders">← Đơn hàng của tôi</Link></div></section>;
  if (!data) notFound();
  const order = data as CustomerOrderDetail;
  const { data: store } = await supabase.from("stores").select("name,logo_url,phone,address").eq("slug", order.store_slug).maybeSingle();
  const isDelivery = order.fulfillment === "delivery";
  const fulfillment = isDelivery ? "Giao hàng tận nơi" : "Nhận tại cửa hàng";
  const payment = order.payment_method === "bank_transfer" ? "Chuyển khoản QR" : isDelivery ? "Tiền mặt khi nhận hàng" : "Tiền mặt tại cửa hàng";
  const steps = [
    { value: "pending", label: "Đã đặt hàng" },
    { value: "confirmed", label: "Đã xác nhận" },
    { value: "preparing", label: "Đang chuẩn bị" },
    { value: "ready", label: isDelivery ? "Sẵn sàng bàn giao" : "Sẵn sàng nhận" },
    ...(isDelivery ? [{ value: "out_for_delivery", label: "Đang giao hàng" }] : []),
    { value: "completed", label: isDelivery ? "Đã giao hàng" : "Đã nhận hàng" },
  ];
  const currentStep = steps.findIndex(step => step.value === order.status);
  const ended = order.status === "cancelled" || order.status === "rejected";
  const itemCount = order.items.reduce((sum, item) => sum + Number(item.quantity), 0);
  const canRequestCancellation = (order.status === "pending" || order.status === "confirmed") && order.cancellation_request_status === "none";
  return <section className="customer-detail-content"><nav className="customer-detail-breadcrumb" aria-label="Đường dẫn"><Link href={`/${order.store_slug}`}>Trang cửa hàng</Link><span>›</span><Link href="/customer/orders">Đơn hàng của tôi</Link><span>›</span><b>Chi tiết đơn hàng</b></nav><h1><SidebarIcon name="orders" /> Chi tiết đơn hàng</h1>
        <section className="customer-detail-progress"><header><div><SidebarIcon name="orders" /><div><h2>Đơn hàng {order.public_code}</h2><p>Đặt lúc: {date(order.created_at)}</p></div></div><span className={`customer-detail-badge status-${order.status}`}>{orderStatus(order.status)}</span></header>{ended ? <p className="customer-detail-ended">{order.status === "cancelled" ? "Đơn hàng đã được hủy." : "Cửa hàng đã từ chối đơn hàng."}</p> : currentStep >= 0 ? <ol aria-label="Tiến trình đơn hàng" className="customer-detail-steps">{steps.map((step,index) => <li key={step.value} className={`${index < currentStep ? "done" : ""} ${index === currentStep ? "current" : ""}`} aria-current={index === currentStep ? "step" : undefined}><span className="customer-detail-step-dot">{index < currentStep ? "✓" : index + 1}</span><b>{step.label}</b>{index === 0 && <small>{date(order.created_at)}</small>}</li>)}</ol> : <p className="customer-detail-ended">Trạng thái hiện tại: {orderStatus(order.status)}</p>}</section>
        <div className="customer-detail-info-grid"><section className="customer-detail-card"><h2><SidebarIcon name="accounts" /> Thông tin người nhận</h2><dl><div><dt>Người nhận</dt><dd>{order.customer_name}</dd></div><div><dt>Số điện thoại</dt><dd>{order.customer_phone}</dd></div>{order.customer_email && <div><dt>Email</dt><dd>{order.customer_email}</dd></div>}{order.delivery_address && <div><dt>Địa chỉ</dt><dd>{order.delivery_address}</dd></div>}{order.customer_note && <div><dt>Ghi chú</dt><dd>{order.customer_note}</dd></div>}</dl></section><section className="customer-detail-card"><h2><SidebarIcon name="delivery" /> {isDelivery ? "Thông tin vận chuyển" : "Thông tin nhận tại cửa hàng"}</h2><dl><div><dt>Hình thức</dt><dd>{fulfillment}</dd></div>{!isDelivery && store?.address && <div><dt>Địa chỉ cửa hàng</dt><dd>{store.address}</dd></div>}<div><dt>Trạng thái</dt><dd>{orderStatus(order.status)}</dd></div>{store?.phone && <div><dt>Liên hệ cửa hàng</dt><dd><a href={`tel:${store.phone}`}>{store.phone}</a></dd></div>}</dl>{order.cancellation_request_status === "pending" && <p className="customer-detail-notice">Yêu cầu hủy đang chờ cửa hàng xử lý.</p>}</section></div>
        <div className="customer-detail-bottom-grid"><section className="customer-detail-card"><h2><SidebarIcon name="cart" /> Sản phẩm trong đơn <small>({itemCount} sản phẩm)</small></h2><div className="customer-detail-items">{order.items.map(item => <article key={item.id}><div className="customer-detail-item-image" aria-hidden="true"><SidebarIcon name="cart" /></div><div><b>{item.name}</b>{item.sku && <small>SKU: {item.sku}</small>}<small>{money(item.unit_price_vnd)} / sản phẩm</small></div><span>× {item.quantity}</span><strong>{money(item.unit_price_vnd * item.quantity)}</strong></article>)}</div></section><section className="customer-detail-card customer-detail-summary"><h2><SidebarIcon name="payment" /> Tóm tắt đơn hàng</h2><dl><div><dt>Tạm tính</dt><dd>{money(order.subtotal_vnd)}</dd></div><div><dt>Phí giao hàng</dt><dd>{money(order.delivery_fee_vnd)}</dd></div>{Number(order.discount_vnd) > 0 && <div><dt>Giảm giá{order.promotion_code ? ` · ${order.promotion_code}` : ""}</dt><dd className="discount">−{money(order.discount_vnd)}</dd></div>}<div className="total"><dt>Tổng thanh toán</dt><dd>{money(order.total_vnd)}</dd></div><div><dt>Phương thức</dt><dd>{payment}</dd></div><div><dt>Trạng thái</dt><dd>{paymentStatus(order.payment_status)}</dd></div>{order.refund_amount_vnd != null && <div><dt>Đã hoàn tiền</dt><dd>{money(order.refund_amount_vnd)}</dd></div>}</dl></section></div>
        <div className="customer-detail-actions"><Link href="/customer/orders">← Quay lại danh sách đơn hàng</Link><div className="customer-detail-actions-right">{store?.phone && <a href={`tel:${store.phone}`}><SidebarIcon name="support" /> Liên hệ cửa hàng</a>}{canRequestCancellation && <CustomerCancelOrder publicCode={order.public_code} customerPhone={order.customer_phone} />}</div></div>
      </section>;
}
