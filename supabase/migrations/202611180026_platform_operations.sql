create table public.platform_operations_settings (
  id boolean primary key default true check (id),
  maintenance_enabled boolean not null default false,
  maintenance_message text not null default 'Hệ thống đang bảo trì. Vui lòng quay lại sau.' check (length(trim(maintenance_message)) between 1 and 1000),
  public_signup_enabled boolean not null default true,
  max_notification_length integer not null default 4000 check (max_notification_length between 100 and 4000),
  updated_at timestamptz not null default now()
);
insert into public.platform_operations_settings(id) values (true);
alter table public.platform_operations_settings enable row level security;
revoke all on public.platform_operations_settings from public, anon, authenticated;
grant select on public.platform_operations_settings to anon, authenticated;
grant update on public.platform_operations_settings to authenticated;
create policy platform_operations_read on public.platform_operations_settings for select to anon, authenticated using (true);
create policy platform_operations_update on public.platform_operations_settings for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Auth app metadata is set by Supabase's privileged admin API, not public signup.
-- Admin-created users remain available while public registrations are paused.
create function public.enforce_public_signup_setting() returns trigger
language plpgsql security definer set search_path = '' as $$
declare signup_allowed boolean;
begin
  if new.raw_app_meta_data ->> 'created_by_platform_admin' = 'true' or new.raw_app_meta_data ->> 'account_kind' = 'platform_admin' then return new; end if;
  select public_signup_enabled into signup_allowed from public.platform_operations_settings where id = true for share;
  if signup_allowed is distinct from true then raise exception 'public_registration_disabled' using errcode = 'P0001'; end if;
  return new;
end;
$$;
revoke all on function public.enforce_public_signup_setting() from public, anon, authenticated;
create trigger enforce_public_signup_setting before insert on auth.users for each row execute function public.enforce_public_signup_setting();

create function public.enforce_notification_length() returns trigger
language plpgsql security definer set search_path = '' as $$
declare max_length integer;
begin
  select max_notification_length into max_length from public.platform_operations_settings where id = true for share;
  if max_length is null or length(trim(new.body)) > max_length then raise exception 'notification_length_exceeded' using errcode = 'P0001'; end if;
  return new;
end;
$$;
revoke all on function public.enforce_notification_length() from public, anon, authenticated;
create trigger enforce_notification_length before insert on public.platform_notifications for each row execute function public.enforce_notification_length();
