create or replace function public.get_overview_revenue(p_store_id uuid default null)
returns table (revenue_day date, revenue_vnd bigint, paid_orders bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with period as (
    select (now() at time zone 'Asia/Ho_Chi_Minh')::date as today
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
      and o.payment_confirmed_at >= ((p.today - 6)::timestamp at time zone 'Asia/Ho_Chi_Minh')
      and o.payment_confirmed_at < ((p.today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
    group by 1
  )
  select p.today - d.days_ago, coalesce(t.revenue_vnd, 0), coalesce(t.paid_orders, 0)
  from period p
  cross join generate_series(0, 6) as d(days_ago)
  left join totals t on t.day = p.today - d.days_ago
  order by 1;
$$;

revoke execute on function public.get_overview_revenue(uuid) from public, anon;
grant execute on function public.get_overview_revenue(uuid) to authenticated;
