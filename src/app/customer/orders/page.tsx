import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { date, money, orderStatus, paymentStatus, type CustomerOrder } from "./order-display";
import "./orders.css";

export const metadata = { title: "Đơn hàng của tôi | GrowDesk" };
export const instant = false;

export default async function CustomerOrders({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=customer-orders");
  const params = await searchParams;
  const rawPage = Number(params.page ?? "1");
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 501 ? rawPage : 1;
  const { data, error } = await supabase.rpc("customer_orders", { requested_offset: (page - 1) * 20 });
  const orders = Array.isArray(data) ? data as CustomerOrder[] : [];
  return <main className="customer-orders-page"><header className="customer-orders-top"><Link href="/">GrowDesk</Link><Link href="/">← Trang chủ</Link></header><section className="customer-orders-content"><div className="customer-orders-heading"><div><span>TÀI KHOẢN MUA HÀNG</span><h1>Đơn hàng của tôi</h1><p>Theo dõi các đơn hàng bạn đã đặt bằng tài khoản này.</p></div><Link href="/track-order">Tra cứu bằng mã đơn →</Link></div>{error ? <div className="customer-orders-empty" role="alert"><h2>Chưa tải được đơn hàng</h2><p>Vui lòng thử lại sau hoặc liên hệ hỗ trợ.</p></div> : orders.length === 0 ? <div className="customer-orders-empty"><span>▤</span><h2>{page > 1 ? "Không còn đơn hàng" : "Bạn chưa có đơn hàng nào"}</h2><p>Đơn được đặt khi đăng nhập sẽ xuất hiện tại đây. Các đơn cũ chưa gắn tài khoản có thể tra cứu bằng mã đơn.</p><Link href={page > 1 ? `/customer/orders?page=${page - 1}` : "/track-order"}>{page > 1 ? "← Trang trước" : "Tra cứu đơn hàng"}</Link></div> : <><div className="customer-orders-list">{orders.slice(0, 20).map(order => <article className="customer-order-card" key={order.id}><div className="customer-order-card-top"><div><span>CỬA HÀNG</span><h2>{order.store_name}</h2></div><span className={`customer-order-status status-${order.status}`}>{orderStatus(order.status)}</span></div><div className="customer-order-card-meta"><span>Mã đơn <b>{order.public_code}</b></span><span>Ngày đặt <b>{date(order.created_at)}</b></span><span>Thanh toán <b>{paymentStatus(order.payment_status)}</b></span></div><div className="customer-order-card-footer"><span>{Number(order.item_count)} sản phẩm · <strong>{money(order.total_vnd)}</strong></span><Link href={`/customer/orders/${order.id}`}>Xem chi tiết →</Link></div></article>)}</div><nav className="customer-orders-pagination" aria-label="Phân trang">{page > 1 && <Link href={`/customer/orders?page=${page - 1}`}>← Trang trước</Link>}<span>Trang {page}</span>{orders.length > 20 && page < 501 && <Link href={`/customer/orders?page=${page + 1}`}>Trang sau →</Link>}</nav></>}</section></main>;
}
