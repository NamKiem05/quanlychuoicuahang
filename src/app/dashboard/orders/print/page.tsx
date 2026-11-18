import { exportOrders, methodLabels } from "../export-data";
import type { OrderParams } from "../order-filters";
import PrintButton from "./print-button";
import "./print.css";

export default async function PrintOrders({ searchParams }: { searchParams: Promise<OrderParams> }) {
  const result = await exportOrders(await searchParams);
  if ("error" in result) return <main><h1>Không thể in danh sách</h1><p>{result.error}</p></main>;
  return <main className="orders-print"><div className="orders-print-actions"><PrintButton /></div><h1>Danh sách đơn hàng</h1><p>{result.store.name} · {result.orders.length} đơn · Giờ Việt Nam</p><table><thead><tr><th>Mã đơn</th><th>Khách hàng</th><th>Điện thoại</th><th>Trạng thái</th><th>Thanh toán</th><th>Tổng tiền</th><th>Ngày đặt</th></tr></thead><tbody>{result.orders.map((o) => <tr key={o.id}><td>{o.public_code}</td><td>{o.customer_name}</td><td>{o.customer_phone}</td><td>{result.statusLabels[o.status] ?? o.status}</td><td>{methodLabels[o.payment_method] ?? o.payment_method}</td><td>{Number(o.total_vnd).toLocaleString("vi-VN")} ₫</td><td>{new Date(o.created_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</td></tr>)}</tbody></table>{!result.orders.length && <p>Không có đơn hàng phù hợp.</p>}</main>;
}
