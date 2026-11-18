-- The report uses confirmed platform-plan payments, not store order revenue.
create function public.get_admin_business_report(report_month date)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  first_month date;
  next_month date;
  oldest_month date;
  current_month date := date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh')::date;
  output jsonb;
begin
  if public.is_platform_admin() is not true then raise exception 'not authorized' using errcode = '42501'; end if;
  if report_month is null then raise exception 'invalid month' using errcode = '22023'; end if;
  first_month := date_trunc('month', report_month)::date;
  if first_month < date '2010-01-01' or first_month > current_month then raise exception 'invalid month' using errcode = '22023'; end if;
  next_month := (first_month + interval '1 month')::date;
  oldest_month := (first_month - interval '11 months')::date;
  with valid_payments as (
    select p.* from public.merchant_plan_payments p
    where p.status = 'approved' and p.paid_at <= now()
      and (p.upgrade_expires_at is null or p.paid_at < p.upgrade_expires_at)
  ), current_plans as (
    select distinct on (user_id) user_id, plan
    from valid_payments where valid_until > now()
    order by user_id, valid_until desc, plan desc
  ), monthly as (
    select date_trunc('month', p.paid_at at time zone 'Asia/Ho_Chi_Minh')::date as month_start,
      sum(coalesce(p.upgrade_amount_vnd, p.amount_vnd))::bigint as revenue
    from valid_payments p
    where p.paid_at >= (oldest_month::timestamp at time zone 'Asia/Ho_Chi_Minh')
      and p.paid_at < (next_month::timestamp at time zone 'Asia/Ho_Chi_Minh')
    group by 1
  ), months as (
    select (oldest_month + (n * interval '1 month'))::date as month_start
    from pg_catalog.generate_series(0, 11) as n
  ), selected_payments as (
    select * from valid_payments
    where paid_at >= (first_month::timestamp at time zone 'Asia/Ho_Chi_Minh')
      and paid_at < (next_month::timestamp at time zone 'Asia/Ho_Chi_Minh')
  )
  select jsonb_build_object(
    'month', first_month,
    'new_stores', (select count(*) from public.stores where created_at >= (first_month::timestamp at time zone 'Asia/Ho_Chi_Minh') and created_at < (next_month::timestamp at time zone 'Asia/Ho_Chi_Minh')),
    'total_stores', (select count(*) from public.stores),
    'active_stores', (select count(*) from public.stores where status = 'active'),
    'revenue', coalesce((select sum(coalesce(upgrade_amount_vnd, amount_vnd)) from selected_payments), 0),
    'basic_revenue', coalesce((select sum(coalesce(upgrade_amount_vnd, amount_vnd)) from selected_payments where plan = 'basic'), 0),
    'plus_revenue', coalesce((select sum(coalesce(upgrade_amount_vnd, amount_vnd)) from selected_payments where plan = 'plus'), 0),
    'upgrade_count', (select count(*) from selected_payments where upgrade_amount_vnd is not null),
    'payment_count', (select count(*) from selected_payments),
    'active_basic', (select count(*) from current_plans where plan = 'basic'),
    'active_plus', (select count(*) from current_plans where plan = 'plus'),
    'monthly_revenue', (select jsonb_agg(jsonb_build_object('month', m.month_start, 'amount', coalesce(d.revenue, 0)) order by m.month_start) from months m left join monthly d on d.month_start = m.month_start)
  ) into output;
  return output;
end; $$;
revoke all on function public.get_admin_business_report(date) from public, anon, authenticated;
grant execute on function public.get_admin_business_report(date) to authenticated;
