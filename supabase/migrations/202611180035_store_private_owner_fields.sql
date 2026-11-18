-- Limit direct API access to public store columns. Internal owner IDs must be
-- accessed via authorized server-side code or the scoped function below.
revoke select on public.stores from public, anon, authenticated;
revoke select (created_by, billing_owner_id) on public.stores from public, anon, authenticated;
do $$
declare visible_columns text;
begin
  select pg_catalog.string_agg(pg_catalog.format('%I', a.attname), ', ' order by a.attnum)
    into visible_columns
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.stores'::regclass and a.attnum > 0 and not a.attisdropped
      and a.attname not in ('created_by', 'billing_owner_id');
  execute 'grant select (' || visible_columns || ') on public.stores to anon, authenticated';
end $$;

create function public.get_store_billing_owner(requested_store uuid)
returns table(billing_owner_id uuid) language sql stable security definer set search_path = '' as $$
  select s.billing_owner_id from public.stores s
  where s.id = requested_store and (public.is_platform_admin() or public.has_store_role(s.id));
$$;
revoke all on function public.get_store_billing_owner(uuid) from public, anon, authenticated;
grant execute on function public.get_store_billing_owner(uuid) to authenticated;
