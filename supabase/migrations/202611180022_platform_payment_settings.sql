-- This switch only controls creation of new plan payments. Existing transfers
-- must continue to be accepted and reconciled by the authenticated webhook.
create table public.platform_payment_settings (
  id boolean primary key default true check (id),
  sepay_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.platform_payment_settings (id) values (true);
alter table public.platform_payment_settings enable row level security;
grant select on public.platform_payment_settings to anon, authenticated;
grant update on public.platform_payment_settings to authenticated;
create policy platform_payment_settings_read on public.platform_payment_settings for select to anon, authenticated using (true);
create policy platform_payment_settings_update on public.platform_payment_settings for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

create function public.enforce_plan_payment_enabled() returns trigger
language plpgsql security definer set search_path = '' as $$
declare enabled boolean;
begin
  select sepay_enabled into enabled from public.platform_payment_settings where id = true for share;
  if enabled is distinct from true then raise exception 'plan_payments_disabled' using errcode = 'P0001'; end if;
  return new;
end;
$$;
revoke all on function public.enforce_plan_payment_enabled() from public, anon, authenticated;
create trigger enforce_plan_payment_enabled before insert on public.merchant_plan_payments
for each row execute function public.enforce_plan_payment_enabled();
