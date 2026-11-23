begin;

create table public.shipping_providers (
  code text primary key check (code ~ '^[a-z][a-z0-9_-]{1,39}$'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  logo_url text check (char_length(logo_url) <= 500 and logo_url ~ '^https://'),
  catalog_enabled boolean not null default false,
  -- This phase has a GHN connection checker, but no Hybrid Shipping adapter.
  integration_enabled boolean not null default false check (not integration_enabled)
);

insert into public.shipping_providers (code, name, catalog_enabled) values
  ('ghn', 'Giao Hàng Nhanh', true),
  ('ghtk', 'Giao Hàng Tiết Kiệm', true),
  ('viettel-post', 'Viettel Post', true);

create table public.shipping_provider_accounts (
  id uuid primary key default gen_random_uuid(),
  provider_code text not null references public.shipping_providers(code),
  scope text not null check (scope in ('platform', 'shop')),
  store_id uuid references public.stores(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  environment text not null check (environment in ('simulation', 'sandbox', 'production')),
  external_shop_id text not null check (char_length(btrim(external_shop_id)) between 1 and 80),
  credential_ciphertext text check (credential_ciphertext ~ '^v[1-9][0-9]*:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$'),
  config_revision uuid not null default gen_random_uuid(),
  enabled boolean not null default false,
  last_checked_at timestamptz,
  connection_status text not null default 'not_configured'
    check (connection_status in ('not_configured', 'verified', 'failed')),
  created_at timestamptz not null default now(),
  check ((scope = 'platform' and store_id is null) or (scope = 'shop' and store_id is not null)),
  check (not enabled or (
    provider_code = 'ghn' and environment = 'sandbox' and connection_status = 'verified'
    and credential_ciphertext is not null
  )),
  unique nulls not distinct (provider_code, environment, scope, store_id, external_shop_id)
);

create index shipping_accounts_scope_created_idx
  on public.shipping_provider_accounts (scope, created_at desc, id);
create index shipping_accounts_store_idx on public.shipping_provider_accounts (store_id);

create table public.shipping_account_checks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.shipping_provider_accounts(id) on delete restrict,
  config_revision uuid not null,
  actor_id uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  result text not null default 'running'
    check (result in ('running', 'not_configured', 'verified', 'failed', 'superseded')),
  error_code text check (error_code in (
    'CHECK_DISABLED', 'UNSUPPORTED', 'PROVIDER_DISABLED', 'TOKEN_MISSING',
    'KEY_UNAVAILABLE', 'INVALID_TOKEN', 'SHOP_ACCESS_DENIED', 'SHOP_NOT_FOUND',
    'PROVIDER_UNAVAILABLE', 'CHECK_EXPIRED', 'CONFIG_CHANGED'
  )),
  check ((result = 'running') = (finished_at is null))
);
create index shipping_checks_account_started_idx
  on public.shipping_account_checks (account_id, started_at desc, id);

alter table public.shipping_providers enable row level security;
alter table public.shipping_provider_accounts enable row level security;
alter table public.shipping_account_checks enable row level security;
revoke all on public.shipping_providers, public.shipping_provider_accounts, public.shipping_account_checks
  from public, anon, authenticated;
grant select on public.shipping_providers to authenticated;
grant select (id, provider_code, scope, store_id, name, environment, external_shop_id, enabled,
  last_checked_at, connection_status, created_at) on public.shipping_provider_accounts to authenticated;
grant select (id, account_id, started_at, finished_at, result, error_code)
  on public.shipping_account_checks to authenticated;
grant select, insert, update on public.shipping_providers, public.shipping_provider_accounts,
  public.shipping_account_checks to service_role;

create policy shipping_providers_admin_read on public.shipping_providers
  for select to authenticated using ((select public.is_platform_admin()));
create policy shipping_accounts_admin_read on public.shipping_provider_accounts
  for select to authenticated using ((select public.is_platform_admin()));
create policy shipping_checks_admin_read on public.shipping_account_checks
  for select to authenticated using ((select public.is_platform_admin()));

-- Serialize check claims per account and save a history row before any network call.
create function public.begin_shipping_account_check(target_id uuid, actor uuid)
returns uuid language plpgsql set search_path = '' as $$
declare
  revision uuid;
  check_id uuid;
begin
  select a.config_revision into strict revision
  from public.shipping_provider_accounts a
  where a.id = target_id and a.scope = 'platform' for update;

  if exists (
    select 1 from public.shipping_account_checks c where c.account_id = target_id
      and (c.started_at > now() - interval '30 seconds'
        or (c.result = 'running' and c.started_at > now() - interval '3 minutes'))
  ) then return null; end if;

  update public.shipping_account_checks set result = 'failed', error_code = 'CHECK_EXPIRED', finished_at = now()
  where account_id = target_id and result = 'running';

  insert into public.shipping_account_checks (account_id, config_revision, actor_id)
  values (target_id, revision, actor) returning id into check_id;
  return check_id;
end;
$$;

create function public.finish_shipping_account_check(
  target_id uuid, check_id uuid, check_result text, failure_code text
) returns text language plpgsql set search_path = '' as $$
declare
  revision uuid;
  claimed_revision uuid;
begin
  if check_result is null or check_result not in ('verified', 'failed', 'not_configured') then
    raise exception 'invalid check result' using errcode = '22023';
  end if;

  select a.config_revision into strict revision
  from public.shipping_provider_accounts a
  where a.id = target_id and a.scope = 'platform' for update;

  select c.config_revision into strict claimed_revision
  from public.shipping_account_checks c
  where c.id = check_id and c.account_id = target_id and c.result = 'running' for update;

  if revision <> claimed_revision then
    check_result := 'superseded';
    failure_code := 'CONFIG_CHANGED';
  else
    update public.shipping_provider_accounts
    set last_checked_at = now(), connection_status = check_result, enabled = enabled and check_result = 'verified'
    where id = target_id;
  end if;

  update public.shipping_account_checks
  set result = check_result, error_code = failure_code, finished_at = now()
  where id = check_id;
  return check_result;
end;
$$;

revoke all on function public.begin_shipping_account_check(uuid, uuid),
  public.finish_shipping_account_check(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.begin_shipping_account_check(uuid, uuid),
  public.finish_shipping_account_check(uuid, uuid, text, text) to service_role;

commit;
