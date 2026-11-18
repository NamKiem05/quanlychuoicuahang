create table public.admin_store_deletions (
  id bigint generated always as identity primary key,
  store_id uuid not null,
  store_name text not null,
  actor_id uuid not null references auth.users(id),
  deleted_at timestamptz not null default now()
);
alter table public.admin_store_deletions enable row level security;
revoke all on public.admin_store_deletions from public, anon, authenticated;
grant select on public.admin_store_deletions to authenticated;
create policy admin_store_deletions_admin_read on public.admin_store_deletions for select to authenticated using ((select public.is_platform_admin()));

create function public.admin_delete_empty_store(requested_store_id uuid, confirmation_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.stores%rowtype;
begin
  if public.is_platform_admin() is not true then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into target from public.stores where id = requested_store_id for update;
  if not found then raise exception 'store not found' using errcode = 'P0002'; end if;
  if confirmation_name is distinct from target.name then raise exception 'confirmation mismatch' using errcode = '22023'; end if;
  if exists (select 1 from public.orders where store_id = target.id) or exists (select 1 from public.reviews where store_id = target.id) then
    raise exception 'store has orders or reviews' using errcode = '23503';
  end if;
  insert into public.admin_store_deletions(store_id, store_name, actor_id) values (target.id, target.name, auth.uid());
  delete from public.stores where id = target.id;
end;
$$;
revoke all on function public.admin_delete_empty_store(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_delete_empty_store(uuid, text) to authenticated;
