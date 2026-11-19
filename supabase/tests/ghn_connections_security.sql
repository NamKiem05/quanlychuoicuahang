-- Run on GrowDesk Test after 202611190005. No data is modified.
do $$ begin
  if not (select relrowsecurity from pg_class where oid='public.store_ghn_connections'::regclass) then raise exception 'RLS is disabled'; end if;
  if has_table_privilege('anon','public.store_ghn_connections','SELECT') or has_table_privilege('authenticated','public.store_ghn_connections','SELECT') or has_table_privilege('authenticated','public.store_ghn_connections','INSERT') or has_table_privilege('authenticated','public.store_ghn_connections','UPDATE') or has_table_privilege('authenticated','public.store_ghn_connections','DELETE') then raise exception 'GHN credentials accessible to client roles'; end if;
  if not has_table_privilege('service_role','public.store_ghn_connections','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Server service role lacks access'; end if;
end $$;
