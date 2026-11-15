-- Give a store owner the saved point so their map picker can open on the current pin.
create or replace function public.get_store_location_coordinates(requested_store_id uuid)
returns table(latitude double precision, longitude double precision)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    extensions.st_y(s.location::extensions.geometry),
    extensions.st_x(s.location::extensions.geometry)
  from public.stores as s
  where s.id = requested_store_id
    and s.location is not null
    and public.has_store_role(s.id, array['owner']::public.store_member_role[])
  limit 1;
$$;

revoke all on function public.get_store_location_coordinates(uuid) from public, anon;
grant execute on function public.get_store_location_coordinates(uuid) to authenticated;
