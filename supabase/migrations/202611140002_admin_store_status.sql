-- Let platform admins approve and suspend storefronts without granting owners
-- direct permission to edit the store status column.

create function public.admin_set_store_status(
  requested_store_id uuid,
  requested_status public.store_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.is_platform_admin()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.stores
  set status = requested_status
  where id = requested_store_id;

  if not found then
    raise exception 'store not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.admin_set_store_status(uuid, public.store_status) from public;
revoke execute on function public.admin_set_store_status(uuid, public.store_status) from anon;
grant execute on function public.admin_set_store_status(uuid, public.store_status) to authenticated;
