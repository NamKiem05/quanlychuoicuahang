import Link from "next/link";
import { connection } from "next/server";
import type { createClient } from "@/lib/supabase/server";
import OrdersWatchRefresh from "./orders-watch-refresh";
import "./orders-to-watch.css";

const pendingMinutes = 15;
const pageLimit = 5;
const fields = "id, store_id, public_code";

function elapsedTime(since: string | null, now: number) {
  if (!since) return "Chưa rõ thời điểm";
  const minutes = Math.max(0, Math.floor((now - Date.parse(since)) / 60_000));
  if (minutes === 0) return "Dưới 1 phút";
  if (minutes < 60) return `${minutes} phút`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} giờ ${minutes % 60} phút`;
  return `${Math.floor(minutes / 1440)} ngày ${Math.floor(minutes % 1440 / 60)} giờ`;
}

export default async function OrdersToWatch({ supabase, stores }: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  stores: { id: string; name: string }[];
}) {
  await connection();
  const now = new Date();
  const pendingBefore = new Date(now.getTime() - pendingMinutes * 60_000).toISOString();
  const [pending, overdue, cancellation] = await Promise.all([
    supabase.from("orders").select(`${fields}, since:created_at`, { count: "exact" })
      .eq("status", "pending").neq("cancellation_request_status", "pending").lte("created_at", pendingBefore)
      .order("created_at").order("id").limit(pageLimit),
    supabase.from("orders").select(`${fields}, since:estimated_ready_at`, { count: "exact" })
      .eq("fulfillment", "pickup").in("status", ["confirmed", "preparing"]).neq("cancellation_request_status", "pending")
      .lt("estimated_ready_at", now.toISOString()).order("estimated_ready_at").order("id").limit(pageLimit),
    supabase.from("orders").select(`${fields}, since:cancellation_requested_at`, { count: "exact" })
      .eq("cancellation_request_status", "pending").order("cancellation_requested_at", { nullsFirst: false })
      .order("id").limit(pageLimit),
  ]);
  const names = new Map(stores.map((store) => [store.id, store.name]));
  const groups = [
    { id: "pending", title: "Chờ xác nhận", detail: `Đã chờ từ ${pendingMinutes} phút`, result: pending },
    { id: "overdue", title: "Quá giờ chuẩn bị", detail: "Đơn nhận tại quán chưa sẵn sàng", result: overdue },
    { id: "cancellation", title: "Yêu cầu hủy", detail: "Đang chờ cửa hàng xử lý", result: cancellation },
  ];

  return (
    <section className="admin-orders-watch" aria-labelledby="admin-orders-watch-title">
      <OrdersWatchRefresh />
      <header>
        <h2 id="admin-orders-watch-title">Đơn hàng cần theo dõi</h2>
        <Link href="/admin/orders">Tất cả đơn hàng →</Link>
      </header>
      <div className="admin-orders-watch-grid">
        {groups.map(({ id, title, detail, result }) => (
          <section key={id} className="admin-orders-watch-group" aria-labelledby={`orders-watch-${id}`}>
            <h3 id={`orders-watch-${id}`}>{title}{!result.error && <span>{result.count ?? 0}</span>}</h3>
            <p>{detail}</p>
            {result.error ? <p role="alert">Chưa tải được nhóm đơn này.</p> : result.data?.length ? (
              <ul>
                {result.data.map((order) => {
                  const query = new URLSearchParams({ q: order.public_code, store_id: order.store_id, open_order: order.id });
                  return (
                    <li key={order.id}>
                      <div>
                        <strong>{order.public_code}</strong>
                        <span>{names.get(order.store_id) ?? "Cửa hàng"}</span>
                        <small>{id === "overdue" ? "Trễ" : "Chờ"} {elapsedTime(order.since, now.getTime())}</small>
                      </div>
                      <div className="admin-orders-watch-actions">
                        <Link href={`/admin/orders?${query}`} aria-label={`Xem đơn ${order.public_code}`}>Xem đơn</Link>
                        <Link href={`/admin/messages?store=${encodeURIComponent(order.store_id)}`} aria-label={`Nhắn quán về đơn ${order.public_code}`}>Nhắn quán</Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : <p>Không có đơn cần theo dõi.</p>}
            {(result.count ?? 0) > pageLimit && <p>Hiển thị {pageLimit} đơn chờ lâu nhất.</p>}
          </section>
        ))}
      </div>
    </section>
  );
}
