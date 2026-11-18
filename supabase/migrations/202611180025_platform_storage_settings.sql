-- Planning metadata only; this table does not schedule or execute backups.
create table public.platform_storage_settings (
  id boolean primary key default true check (id),
  backup_frequency text not null default 'none' check (backup_frequency in ('none','daily','weekly','monthly')),
  backup_time time not null default '02:00',
  backup_weekday integer not null default 1 check (backup_weekday between 1 and 7),
  backup_monthday integer not null default 1 check (backup_monthday between 1 and 28),
  retention_days integer not null default 30 check (retention_days between 1 and 3650),
  notes text not null default '' check (length(notes) <= 1000),
  updated_at timestamptz not null default now()
);
insert into public.platform_storage_settings(id) values (true);
alter table public.platform_storage_settings enable row level security;
revoke all on public.platform_storage_settings from public, anon, authenticated;
grant select, update on public.platform_storage_settings to authenticated;
create policy platform_storage_settings_read on public.platform_storage_settings for select to authenticated using (public.is_platform_admin());
create policy platform_storage_settings_update on public.platform_storage_settings for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
