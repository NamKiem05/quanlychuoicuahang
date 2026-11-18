create or replace function public.get_store_best_selling_products(
  p_store_id uuid, p_start_date date, p_end_date date
)
returns table (product_name text, quantity_sold bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with product_totals as (
    select
      i.product_id,
      case when i.product_id is null then i.product_name_snapshot end as deleted_name,
      max(i.product_name_snapshot) as snapshot_name,
      sum(i.quantity) as units
    from public.orders o
    join public.order_items i on i.order_id = o.id and i.store_id = o.store_id
    where o.store_id = p_store_id
      and p_end_date - p_start_date between 0 and 365
      and o.payment_status = 'paid'
      and o.status not in ('cancelled', 'rejected')
      and o.payment_confirmed_at >= (p_start_date::timestamp at time zone 'Asia/Ho_Chi_Minh')
      and o.payment_confirmed_at < ((p_end_date + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
    group by i.product_id, deleted_name
  )
  select coalesce(p.name, t.snapshot_name), t.units
  from product_totals t
  left join public.products p on p.id = t.product_id and p.store_id = p_store_id
  order by t.units desc, 1, t.product_id, t.deleted_name
  limit 5;
$$;

revoke execute on function public.get_store_best_selling_products(uuid, date, date) from public, anon;
grant execute on function public.get_store_best_selling_products(uuid, date, date) to authenticated;
