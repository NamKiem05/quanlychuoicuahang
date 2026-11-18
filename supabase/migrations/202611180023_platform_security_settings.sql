create table public.platform_security_settings (
  id boolean primary key default true check (id),
  staff_password_min_length integer not null default 12 check (staff_password_min_length between 12 and 64),
  updated_at timestamptz not null default now()
);
insert into public.platform_security_settings(id) values (true);
alter table public.platform_security_settings enable row level security;
revoke all on public.platform_security_settings from public, anon, authenticated;
grant select, update on public.platform_security_settings to authenticated;
create policy platform_security_settings_read on public.platform_security_settings for select to authenticated using (public.is_platform_admin());
create policy platform_security_settings_update on public.platform_security_settings for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
