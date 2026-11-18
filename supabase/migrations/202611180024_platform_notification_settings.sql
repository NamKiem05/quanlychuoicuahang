create table public.platform_notification_settings (
  id boolean primary key default true check (id),
  in_app_enabled boolean not null default true,
  maintenance_enabled boolean not null default true,
  payment_enabled boolean not null default true,
  maintenance_title text not null default 'Thông báo bảo trì' check (length(trim(maintenance_title)) between 3 and 160),
  maintenance_body text not null default 'Hệ thống sẽ được bảo trì. Vui lòng theo dõi thông báo để biết thời gian cụ thể.' check (length(trim(maintenance_body)) between 1 and 4000),
  payment_title text not null default 'Thông báo thanh toán' check (length(trim(payment_title)) between 3 and 160),
  payment_body text not null default 'Vui lòng kiểm tra thông tin thanh toán dịch vụ của cửa hàng.' check (length(trim(payment_body)) between 1 and 4000),
  updated_at timestamptz not null default now()
);
insert into public.platform_notification_settings(id) values (true);
alter table public.platform_notification_settings enable row level security;
revoke all on public.platform_notification_settings from public, anon, authenticated;
grant select, update on public.platform_notification_settings to authenticated;
create policy platform_notification_settings_read on public.platform_notification_settings for select to authenticated using (public.is_platform_admin());
create policy platform_notification_settings_update on public.platform_notification_settings for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

create function public.enforce_platform_notification_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cfg public.platform_notification_settings%rowtype;
begin
  select * into cfg from public.platform_notification_settings where id = true for share;
  if not found or not cfg.in_app_enabled or (new.category = 'maintenance' and not cfg.maintenance_enabled) or (new.category = 'payment' and not cfg.payment_enabled) then
    raise exception 'platform_notification_disabled' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_platform_notification_settings() from public, anon, authenticated;
create trigger enforce_platform_notification_settings before insert on public.platform_notifications for each row execute function public.enforce_platform_notification_settings();
