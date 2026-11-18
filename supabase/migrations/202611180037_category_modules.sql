create table public.business_category_module_settings (
  category_id uuid not null references public.business_categories(id) on delete cascade,
  module_code text not null references public.platform_modules(code) on delete cascade,
  enabled boolean not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (category_id, module_code)
);
alter table public.business_category_module_settings enable row level security;
revoke all on public.business_category_module_settings from public, anon, authenticated;
grant select on public.business_category_module_settings to authenticated;
create policy category_module_admin_read on public.business_category_module_settings for select to authenticated using (public.is_platform_admin());

-- Per-store choice wins, then the category setting, then the global default.
create or replace function public.store_module_enabled(target_store uuid, target_module text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select coalesce(sm.enabled, cm.enabled, m.default_enabled)
    from public.stores st cross join public.platform_modules m
    left join public.store_module_settings sm on sm.store_id=st.id and sm.module_code=m.code
    left join public.business_category_module_settings cm on cm.category_id=st.business_category_id and cm.module_code=m.code
    where st.id=target_store and m.code=target_module
      and (public.is_platform_admin() or public.has_store_role(st.id) or (select auth.role()) = 'service_role')), false);
$$;
create function public.admin_set_category_module(target_category uuid, target_module text, next_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.is_platform_admin() is not true then raise exception 'not authorized' using errcode='42501'; end if;
  if next_enabled is null or not exists(select 1 from public.business_categories where id=target_category) or not exists(select 1 from public.platform_modules where code=target_module) then raise exception 'invalid category or module' using errcode='22023'; end if;
  insert into public.business_category_module_settings(category_id,module_code,enabled,updated_by) values(target_category,target_module,next_enabled,auth.uid())
  on conflict(category_id,module_code) do update set enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=now();
end; $$;
revoke all on function public.admin_set_category_module(uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.admin_set_category_module(uuid,text,boolean) to authenticated;

create function public.admin_reset_store_module(target_store uuid, target_module text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.is_platform_admin() is not true then raise exception 'not authorized' using errcode='42501'; end if;
  if not exists(select 1 from public.stores where id=target_store) or not exists(select 1 from public.platform_modules where code=target_module) then raise exception 'invalid store or module' using errcode='22023'; end if;
  delete from public.store_module_settings where store_id=target_store and module_code=target_module;
end; $$;
revoke all on function public.admin_reset_store_module(uuid,text) from public, anon, authenticated;
grant execute on function public.admin_reset_store_module(uuid,text) to authenticated;
