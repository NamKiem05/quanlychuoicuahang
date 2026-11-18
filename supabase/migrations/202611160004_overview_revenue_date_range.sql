create or replace function public.get_overview_revenue(
  p_store_id uuid, p_start_date date, p_end_date date
)
returns table (revenue_day date, revenue_vnd bigint, paid_orders bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with period as (
    select p_start_date as first_day, p_end_date as last_day
    where p_end_date - p_start_date between 0 and 365
  ),
  totals as (
    select
      (o.payment_confirmed_at at time zone 'Asia/Ho_Chi_Minh')::date as day,
      sum(o.total_vnd)::bigint as revenue_vnd,
      count(*) as paid_orders
    from public.orders o
    cross join period p
    where o.payment_status = 'paid'
      and o.status not in ('cancelled', 'rejected')
      and (p_store_id is null or o.store_id = p_store_id)
      and o.payment_confirmed_at >= (p.first_day::timestamp at time zone 'Asia/Ho_Chi_Minh')
      and o.payment_confirmed_at < ((p.last_day + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
    group by 1
  )
  select p.first_day + d.day_offset, coalesce(t.revenue_vnd, 0), coalesce(t.paid_orders, 0)
  from period p
  cross join lateral generate_series(0, p.last_day - p.first_day) as d(day_offset)
  left join totals t on t.day = p.first_day + d.day_offset
  order by 1;
$$;

revoke execute on function public.get_overview_revenue(uuid, date, date) from public, anon;
grant execute on function public.get_overview_revenue(uuid, date, date) to authenticated;

create or replace function public.get_overview_revenue(p_store_id uuid default null)
returns table (revenue_day date, revenue_vnd bigint, paid_orders bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.*
  from (select (now() at time zone 'Asia/Ho_Chi_Minh')::date as today) p
  cross join lateral public.get_overview_revenue(p_store_id, p.today - 6, p.today) r;
$$;
