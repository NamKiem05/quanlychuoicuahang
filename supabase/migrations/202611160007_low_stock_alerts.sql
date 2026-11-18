alter table public.products
  add column if not exists low_stock_threshold integer not null default 5
  check (low_stock_threshold >= 0);

create or replace function public.get_store_low_stock_products(p_store_id uuid)
returns table (id uuid, name text, stock_quantity integer, low_stock_threshold integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, p.name, p.stock_quantity, p.low_stock_threshold
  from public.products p
  where p.store_id = p_store_id
    and ((select public.has_store_role(p_store_id)) or (select public.is_platform_admin()))
    and p.status = 'active'
    and p.stock_quantity <= p.low_stock_threshold
  order by p.stock_quantity, p.name, p.id
  limit 10;
$$;

revoke execute on function public.get_store_low_stock_products(uuid) from public, anon;
grant execute on function public.get_store_low_stock_products(uuid) to authenticated;
