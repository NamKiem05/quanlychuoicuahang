import { getMerchantContext, orderStatusLabels } from "../data";
import { ordersQuery, readOrderFilters, type OrderParams } from "./order-filters";

export const methodLabels: Record<string, string> = { cash_on_pickup: "Tiền mặt tại cửa hàng", cash_on_delivery: "Tiền mặt khi nhận hàng", bank_transfer: "Chuyển khoản QR" };
export async function exportOrders(params: OrderParams) {
  const { supabase, store } = await getMerchantContext();
  if (!store) return { error: "Không tìm thấy cửa hàng." } as const;
  const filters = readOrderFilters(params);
  if (filters.error) return { error: filters.error } as const;
  const first = await ordersQuery(supabase, store.id, filters).range(0, 999);
  if (first.error || first.count === null) return { error: "Không tải được danh sách đơn hàng." } as const;
  if (first.count > 10000) return { error: "Có hơn 10.000 đơn phù hợp. Hãy thu hẹp bộ lọc trước khi xuất hoặc in." } as const;
  const orders = first.data ?? [];
  for (let offset = 1000; offset < first.count; offset += 1000) {
    const next = await ordersQuery(supabase, store.id, filters).range(offset, offset + 999);
    if (next.error || !next.data) return { error: "Không tải được đầy đủ danh sách đơn hàng." } as const;
    orders.push(...next.data);
  }
  return { store, orders, statusLabels: orderStatusLabels } as const;
}
