create table public.platform_modules (
  code text primary key,
  name text not null,
  description text not null default '',
  default_enabled boolean not null default true
);
insert into public.platform_modules(code, name, description) values ('brands', 'Quản lý thương hiệu', 'Quản lý thương hiệu và gắn thương hiệu cho sản phẩm.');
create table public.store_module_settings (
  store_id uuid not null references public.stores(id) on delete cascade,
  module_code text not null references public.platform_modules(code) on delete restrict,
  enabled boolean not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (store_id, module_code)
);
alter table public.platform_modules enable row level security;
alter table public.store_module_settings enable row level security;
revoke all on public.platform_modules, public.store_module_settings from public, anon, authenticated;
grant select on public.platform_modules, public.store_module_settings to authenticated;
create policy modules_admin_read on public.platform_modules for select to authenticated using (public.is_platform_admin());
create policy store_module_settings_admin_read on public.store_module_settings for select to authenticated using (public.is_platform_admin());

create function public.store_module_enabled(target_store uuid, target_module text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (public.is_platform_admin() or public.has_store_role(target_store) or (select auth.role()) = 'service_role') and coalesce((select coalesce(s.enabled, m.default_enabled) from public.platform_modules m left join public.store_module_settings s on s.module_code=m.code and s.store_id=target_store where m.code=target_module), false);
$$;
revoke all on function public.store_module_enabled(uuid,text) from public, anon, authenticated;
grant execute on function public.store_module_enabled(uuid,text) to authenticated, service_role;
-- Restrict direct access to the brand table, including requests that bypass the app.
create policy store_brands_module_enabled on public.store_brands as restrictive for all to authenticated
  using (public.is_platform_admin() or public.store_module_enabled(store_id, 'brands'))
  with check (public.is_platform_admin() or public.store_module_enabled(store_id, 'brands'));

create function public.guard_product_brand_module()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.brand_id is not null) or (tg_op = 'UPDATE' and new.brand_id is distinct from old.brand_id) then
    if not public.is_platform_admin() and (select auth.role()) is distinct from 'service_role' and not public.store_module_enabled(new.store_id, 'brands') then
      raise exception 'brand_module_disabled' using errcode = '42501';
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.guard_product_brand_module() from public, anon, authenticated;
create trigger product_brand_module_guard before insert or update of brand_id on public.products for each row execute function public.guard_product_brand_module();

create function public.admin_set_store_module(target_store uuid, target_module text, next_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.is_platform_admin() is not true then raise exception 'not authorized' using errcode='42501'; end if;
  if next_enabled is null or not exists(select 1 from public.stores where id=target_store) or not exists(select 1 from public.platform_modules where code=target_module) then raise exception 'invalid module or store' using errcode='22023'; end if;
  insert into public.store_module_settings(store_id,module_code,enabled,updated_by) values(target_store,target_module,next_enabled,auth.uid())
  on conflict(store_id,module_code) do update set enabled=excluded.enabled, updated_by=excluded.updated_by, updated_at=now();
end; $$;
revoke all on function public.admin_set_store_module(uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.admin_set_store_module(uuid,text,boolean) to authenticated;
