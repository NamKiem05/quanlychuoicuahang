import type { createClient } from "@/lib/supabase/server";
import { orderStatusLabels } from "../data";

export type OrderParams = Record<string, string | undefined>;
const methods = ["cash_on_pickup", "cash_on_delivery", "bank_transfer"];
const sorts = ["newest", "oldest", "amount_high", "amount_low"];
function date(value: string | undefined) { if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return ""; const d = new Date(`${value}T00:00:00Z`); return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === value ? value : ""; }
function amount(value: string | undefined) { return value && /^\d{1,15}$/.test(value) && Number.isSafeInteger(Number(value)) ? value : ""; }
export function readOrderFilters(query: OrderParams) {
  const q = (query.q ?? "").trim().replace(/[^\p{L}\p{N}\s+-]/gu, "").slice(0, 60).trim();
  const filter_status = query.filter_status && Object.hasOwn(orderStatusLabels, query.filter_status) ? query.filter_status : "";
  const payment = query.payment && methods.includes(query.payment) ? query.payment : "";
  const from = date(query.from), to = date(query.to), min = amount(query.min), max = amount(query.max);
  const sort = query.sort && sorts.includes(query.sort) ? query.sort : "newest";
  const error = (query.from && !from) || (query.to && !to) || (from && to && from > to) || (query.min && !min) || (query.max && !max) || (min && max && Number(min) > Number(max)) ? "Khoảng ngày hoặc giá trị đơn hàng không hợp lệ." : "";
  return { q, filter_status, payment, from, to, min, max, sort, error };
}
export function ordersQuery(supabase: Awaited<ReturnType<typeof createClient>>, storeId: string, filters: ReturnType<typeof readOrderFilters>) {
  let query = supabase.from("orders").select("id, public_code, customer_name, customer_phone, customer_note, status, fulfillment, delivery_address, delivery_latitude, delivery_longitude, delivery_distance_m, delivery_fee_vnd, payment_method, payment_status, payment_reference, promotion_code, discount_vnd, cancellation_request_status, cancellation_request_reason, cancellation_requested_at, cancellation_decided_at, subtotal_vnd, total_vnd, created_at", { count: "exact" }).eq("store_id", storeId);
  if (filters.q) query = query.or(`public_code.ilike.%${filters.q}%,customer_name.ilike.%${filters.q}%,customer_phone.ilike.%${filters.q}%`);
  if (filters.filter_status) query = query.eq("status", filters.filter_status);
  if (filters.payment) query = query.eq("payment_method", filters.payment);
  if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00+07:00`);
  if (filters.to) { const next = new Date(`${filters.to}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1); query = query.lt("created_at", `${next.toISOString().slice(0, 10)}T00:00:00+07:00`); }
  if (filters.min) query = query.gte("total_vnd", Number(filters.min));
  if (filters.max) query = query.lte("total_vnd", Number(filters.max));
  const column = filters.sort.startsWith("amount_") ? "total_vnd" : "created_at";
  return query.order(column, { ascending: filters.sort === "oldest" || filters.sort === "amount_low" }).order("id", { ascending: true });
}
export function filterParams(filters: ReturnType<typeof readOrderFilters>) {
  return { q: filters.q, filter_status: filters.filter_status, payment: filters.payment, from: filters.from, to: filters.to, min: filters.min, max: filters.max, sort: filters.sort };
}
