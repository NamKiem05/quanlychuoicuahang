-- Only the public presentation mode of an active storefront is exposed.
create function public.get_public_store_merchandise_mode(target_store uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select coalesce(c.merchandise_mode,'general') from public.stores s left join public.business_categories c on c.id=s.business_category_id where s.id=target_store and s.status='active'), 'general');
$$;
revoke all on function public.get_public_store_merchandise_mode(uuid) from public, anon, authenticated;
grant execute on function public.get_public_store_merchandise_mode(uuid) to anon, authenticated;
