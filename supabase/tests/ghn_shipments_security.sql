-- Read-only checks; run on GrowDesk Test after 202611190006.
do $$ begin
  if not (select relrowsecurity from pg_class where oid='public.store_ghn_shipments'::regclass) then raise exception 'RLS is disabled'; end if;
  if has_table_privilege('anon','public.store_ghn_shipments','SELECT') or has_table_privilege('authenticated','public.store_ghn_shipments','SELECT') or has_table_privilege('authenticated','public.store_ghn_shipments','INSERT') or has_table_privilege('authenticated','public.store_ghn_shipments','UPDATE') or has_table_privilege('authenticated','public.store_ghn_shipments','DELETE') then raise exception 'Shipment data is accessible directly to client roles'; end if;
  if not has_table_privilege('service_role','public.store_ghn_shipments','SELECT') or not has_table_privilege('service_role','public.store_ghn_shipments','INSERT') or not has_table_privilege('service_role','public.store_ghn_shipments','UPDATE') then raise exception 'Server service role lacks access'; end if;
end $$;
