create function public.get_admin_store_sales_revenue(requested_store_id uuid)
returns bigint language plpgsql stable security invoker set search_path = '' as $$
declare result bigint;
begin
  if public.is_platform_admin() is not true then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select coalesce(sum(total_vnd), 0)::bigint into result from public.orders
  where store_id = requested_store_id and payment_status = 'paid'
    and status not in ('cancelled', 'rejected');
  return result;
end;
$$;
revoke all on function public.get_admin_store_sales_revenue(uuid) from public, anon, authenticated;
grant execute on function public.get_admin_store_sales_revenue(uuid) to authenticated;
