create table public.platform_general_settings (
  id boolean primary key default true check (id),
  platform_name text not null default 'KingWeb' check (length(trim(platform_name)) between 1 and 100),
  description text not null default '' check (length(description) <= 1000),
  contact_email text not null default '' check (length(contact_email) <= 254),
  support_phone text not null default '' check (length(support_phone) <= 30),
  default_language text not null default 'vi' check (default_language = 'vi'),
  default_timezone text not null default 'Asia/Ho_Chi_Minh' check (default_timezone = 'Asia/Ho_Chi_Minh'),
  logo_url text,
  favicon_url text,
  updated_at timestamptz not null default now()
);
insert into public.platform_general_settings(id) values (true);
alter table public.platform_general_settings enable row level security;
grant select on public.platform_general_settings to anon, authenticated;
grant update on public.platform_general_settings to authenticated;
create policy platform_general_settings_read on public.platform_general_settings for select to anon, authenticated using (true);
create policy platform_general_settings_update on public.platform_general_settings for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('platform-assets', 'platform-assets', true, 2097152, array['image/png','image/jpeg','image/webp','image/x-icon','image/vnd.microsoft.icon'])
on conflict (id) do nothing;
create policy platform_assets_public_read on storage.objects for select to public using (bucket_id = 'platform-assets');
create policy platform_assets_admin_insert on storage.objects for insert to authenticated with check (bucket_id = 'platform-assets' and public.is_platform_admin());
