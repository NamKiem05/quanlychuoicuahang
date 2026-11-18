-- Aggregate platform data on the server; never expose auth.users to the browser.
create function public.get_admin_overview_metrics()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
begin
  if public.is_platform_admin() is not true then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  with valid_payments as (
    select * from public.merchant_plan_payments
    where status = 'approved' and paid_at <= now()
      and (upgrade_expires_at is null or paid_at < upgrade_expires_at)
  ), active_plans as (
    select distinct on (user_id) user_id, plan
    from valid_payments where valid_until > now()
    order by user_id, valid_until desc, plan desc
  )
  select jsonb_build_object(
    'total_users', (select count(*) from auth.users),
    'total_revenue', coalesce((select sum(coalesce(upgrade_amount_vnd, amount_vnd)) from valid_payments), 0),
    'month_revenue', coalesce((select sum(coalesce(upgrade_amount_vnd, amount_vnd)) from valid_payments
      where paid_at >= (date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh')), 0),
    'new_stores', (select count(*) from public.stores where created_at >= (date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh')),
    'basic_count', (select count(*) from active_plans where plan = 'basic'),
    'plus_count', (select count(*) from active_plans where plan = 'plus')
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_admin_overview_metrics() from public, anon, authenticated;
grant execute on function public.get_admin_overview_metrics() to authenticated;
