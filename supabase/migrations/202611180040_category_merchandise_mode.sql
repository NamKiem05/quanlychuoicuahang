alter table public.business_categories add column merchandise_mode text not null default 'general' check (merchandise_mode in ('general','retail','food'));
-- Map only the two existing, unambiguous categories; admins can adjust each category later.
update public.business_categories set merchandise_mode = 'retail' where slug = 'thoi-trang';
update public.business_categories set merchandise_mode = 'food' where slug = 'quan-coffee';
create function public.get_store_merchandise_mode(target_store uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select coalesce(c.merchandise_mode,'general') from public.stores s left join public.business_categories c on c.id=s.business_category_id where s.id=target_store and (public.has_store_role(s.id) or public.is_platform_admin())), 'general');
$$;
revoke all on function public.get_store_merchandise_mode(uuid) from public, anon, authenticated;
grant execute on function public.get_store_merchandise_mode(uuid) to authenticated;
