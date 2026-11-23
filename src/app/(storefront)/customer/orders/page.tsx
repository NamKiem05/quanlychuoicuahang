import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { date, money, orderStatus, paymentStatus, type CustomerOrder } from "./order-display";
import "./orders.css";

export const metadata = { title: "Đơn hàng của tôi | GrowDesk" };
export const instant = false;

export default async function CustomerOrders({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await connection();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=customer-orders");
  const params = await searchParams;
  const rawPage = Number(params.page ?? "1");
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 501 ? rawPage : 1;
  const { data, error } = await supabase.rpc("customer_orders", { requested_offset: (page - 1) * 20 });
  const orders = Array.isArray(data) ? data as CustomerOrder[] : [];
  return (
    <section className="customer-orders-content">
      <div className="customer-orders-heading">
        <div><span>TÀI KHOẢN MUA HÀNG</span><h1>Đơn hàng của tôi</h1><p>Theo dõi thông tin và trạng thái các đơn hàng bạn đã đặt.</p></div>
      </div>
      {error ? <div className="customer-orders-empty" role="alert"><h2>Chưa tải được đơn hàng</h2><p>Vui lòng thử lại sau hoặc liên hệ hỗ trợ.</p></div>
        : orders.length === 0 ? <div className="customer-orders-empty"><span>▤</span><h2>{page > 1 ? "Không còn đơn hàng" : "Bạn chưa có đơn hàng nào"}</h2><p>Đơn được đặt khi đăng nhập sẽ xuất hiện tại đây.</p>{page > 1 ? <Link href={`/customer/orders?page=${page - 1}`}>← Trang trước</Link> : <Link href="/">Khám phá cửa hàng</Link>}</div>
        : <div className="customer-orders-table-card">
          <div className="customer-orders-table-heading"><div><h2>Danh sách đơn hàng</h2><p>Thông tin đơn hàng được cập nhật theo trạng thái xử lý.</p></div><span>{Math.min(orders.length, 20)} đơn hàng trên trang này</span></div>
          <div className="customer-orders-table-scroll" role="region" aria-label="Danh sách đơn hàng" tabIndex={0}>
            <table className="customer-orders-table"><thead><tr><th scope="col">Mã đơn hàng</th><th scope="col">Cửa hàng</th><th scope="col">Ngày đặt</th><th scope="col">Sản phẩm</th><th scope="col">Tổng tiền</th><th scope="col">Thanh toán</th><th scope="col">Trạng thái</th><th scope="col">Thao tác</th></tr></thead>
              <tbody>{orders.slice(0, 20).map(order => <tr key={order.id}><th scope="row"><Link className="customer-order-code" href={`/customer/orders/${order.id}`}>{order.public_code}</Link></th><td className="customer-order-store">{order.store_name}</td><td className="customer-order-date">{date(order.created_at)}</td><td>{Number(order.item_count)}</td><td className="customer-order-amount">{money(order.total_vnd)}</td><td>{paymentStatus(order.payment_status)}</td><td><span className={`customer-order-status status-${order.status}`}>{orderStatus(order.status)}</span></td><td><Link className="customer-order-view" href={`/customer/orders/${order.id}`} aria-label={`Xem chi tiết đơn hàng ${order.public_code}`}>Xem chi tiết <span aria-hidden="true">→</span></Link></td></tr>)}</tbody>
            </table>
          </div>
          <nav className="customer-orders-pagination" aria-label="Phân trang">{page > 1 && <Link href={`/customer/orders?page=${page - 1}`}>← Trang trước</Link>}<span>Trang {page}</span>{orders.length > 20 && page < 501 && <Link href={`/customer/orders?page=${page + 1}`}>Trang sau →</Link>}</nav>
        </div>}
    </section>
  );
}
