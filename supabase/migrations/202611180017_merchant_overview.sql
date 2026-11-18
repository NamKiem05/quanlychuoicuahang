-- Some installations have not applied the earlier inventory alert migration.
-- Keep this dependency safe to apply before or after that migration.
alter table public.products
  add column if not exists low_stock_threshold integer not null default 5
  check (low_stock_threshold >= 0);

-- Store overview aggregates use the caller's existing row-level permissions.
create or replace function public.get_merchant_overview(p_store_id uuid)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
with bounds as (
  select (now() at time zone 'Asia/Ho_Chi_Minh')::date as today
), permitted as (
  select p_store_id as id where public.has_store_role(p_store_id)
), store_orders as (
  select o.*, regexp_replace(o.customer_phone, '[^0-9]', '', 'g') as phone_key
  from public.orders o join permitted p on p.id = o.store_id
), customers as (
  select phone_key, min(created_at) as first_order, count(*) as order_count,
    max(customer_name) as customer_name
  from store_orders where phone_key <> '' group by phone_key
), product_totals as (
  select i.product_id, case when i.product_id is null then i.product_name_snapshot end as deleted_name,
    max(i.product_name_snapshot) as product_name, sum(i.quantity)::bigint as quantity,
    sum(i.quantity::bigint * i.unit_price_snapshot_vnd)::bigint as revenue
  from public.order_items i join store_orders o on o.id = i.order_id and o.store_id = i.store_id
  where o.payment_status = 'paid' and o.status not in ('cancelled', 'rejected')
  group by i.product_id, case when i.product_id is null then i.product_name_snapshot end
), daily_orders as (
  select d.day::date as day, count(o.id)::bigint as total
  from bounds b cross join lateral generate_series(b.today - 6, b.today, interval '1 day') d(day)
  left join store_orders o on (o.created_at at time zone 'Asia/Ho_Chi_Minh')::date = d.day::date
  group by d.day
)
select jsonb_build_object(
  'revenue_today', coalesce((select sum(o.total_vnd) from store_orders o, bounds b where o.payment_status = 'paid' and o.status not in ('cancelled','rejected') and (o.payment_confirmed_at at time zone 'Asia/Ho_Chi_Minh')::date = b.today), 0),
  'revenue_month', coalesce((select sum(o.total_vnd) from store_orders o, bounds b where o.payment_status = 'paid' and o.status not in ('cancelled','rejected') and o.payment_confirmed_at >= (date_trunc('month', b.today)::timestamp at time zone 'Asia/Ho_Chi_Minh') and o.payment_confirmed_at < ((b.today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')), 0),
  'revenue_year', coalesce((select sum(o.total_vnd) from store_orders o, bounds b where o.payment_status = 'paid' and o.status not in ('cancelled','rejected') and o.payment_confirmed_at >= (date_trunc('year', b.today)::timestamp at time zone 'Asia/Ho_Chi_Minh') and o.payment_confirmed_at < ((b.today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')), 0),
  'total_orders', (select count(*) from store_orders),
  'new_orders', (select count(*) from store_orders where status = 'pending'),
  'processing_orders', (select count(*) from store_orders where status in ('confirmed','preparing','ready','out_for_delivery')),
  'completed_orders', (select count(*) from store_orders where status = 'completed'),
  'cancelled_orders', (select count(*) from store_orders where status in ('cancelled','rejected')),
  'total_customers', (select count(*) from customers),
  'new_customers_month', (select count(*) from customers c, bounds b where c.first_order >= (date_trunc('month', b.today)::timestamp at time zone 'Asia/Ho_Chi_Minh') and c.first_order < ((b.today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')),
  'low_stock', (select count(*) from public.products p join permitted a on a.id = p.store_id where p.status = 'active' and p.stock_quantity <= p.low_stock_threshold),
  'daily_orders', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'total', total) order by day) from daily_orders), '[]'::jsonb),
  'top_revenue_products', coalesce((select jsonb_agg(to_jsonb(t)) from (select product_name, quantity, revenue from product_totals order by revenue desc, product_name limit 5) t), '[]'::jsonb),
  'top_customers', coalesce((select jsonb_agg(to_jsonb(t)) from (select customer_name, order_count from customers order by order_count desc, customer_name, phone_key limit 5) t), '[]'::jsonb)
) from permitted;
$$;
revoke all on function public.get_merchant_overview(uuid) from public, anon;
grant execute on function public.get_merchant_overview(uuid) to authenticated;
