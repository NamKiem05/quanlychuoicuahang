begin;

-- GHN Staging is a distinct environment. Existing sandbox accounts are not rewritten.
alter table public.shipping_provider_accounts
  drop constraint shipping_provider_accounts_environment_check,
  add constraint shipping_provider_accounts_environment_check
    check (environment in ('simulation', 'sandbox', 'staging', 'production'));

create table public.shipping_provider_account_versions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null
    references public.shipping_provider_accounts(id) on delete restrict,
  provider_code text not null
    references public.shipping_providers(code) on delete restrict,
  environment text not null check (environment = 'staging'),
  scope text not null check (scope in ('platform', 'shop')),
  store_id uuid references public.stores(id) on delete restrict,
  external_shop_id text not null
    check (char_length(btrim(external_shop_id)) between 1 and 80),
  credential_ciphertext text not null
    check (credential_ciphertext ~ '^v[1-9][0-9]{0,5}:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$'),
  encryption_key_version text not null
    check (encryption_key_version ~ '^v[1-9][0-9]{0,5}$'),
  credential_revision uuid not null default gen_random_uuid(),
  verification_status text not null default 'not_checked'
    check (verification_status in ('not_checked', 'verified', 'failed')),
  enabled boolean not null default false,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  owner_store_key uuid generated always as (
    coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) stored,
  check (id <> '00000000-0000-0000-0000-000000000000'::uuid),
  check (provider_code = 'ghn'),
  check (
    (scope = 'platform' and store_id is null)
    or (scope = 'shop' and store_id is not null
      and store_id <> '00000000-0000-0000-0000-000000000000'::uuid)
  ),
  check (not enabled or (verification_status = 'verified' and revoked_at is null)),
  check (revoked_at is null or enabled = false),
  check (left(credential_ciphertext, length(encryption_key_version) + 1)
      = encryption_key_version || ':'),
  unique (account_id, credential_revision),
  unique (id, provider_code, scope, owner_store_key)
);

create index shipping_account_versions_account_created_idx
  on public.shipping_provider_account_versions (account_id, created_at desc, id);
create index shipping_account_versions_scope_store_idx
  on public.shipping_provider_account_versions (scope, store_id, provider_code, created_at desc);

create table public.shipping_account_version_store_bindings (
  account_version_id uuid not null,
  store_id uuid not null references public.stores(id) on delete restrict,
  provider_code text not null,
  version_scope text not null,
  owner_store_key uuid not null,
  selection_policy text not null check (selection_policy in ('platform', 'shop')),
  created_at timestamptz not null default now(),
  primary key (account_version_id, store_id, provider_code),
  unique (account_version_id, store_id, provider_code, selection_policy),
  foreign key (account_version_id, provider_code, version_scope, owner_store_key)
    references public.shipping_provider_account_versions
      (id, provider_code, scope, owner_store_key)
    on delete restrict,
  check (
    (version_scope = 'platform'
      and owner_store_key = '00000000-0000-0000-0000-000000000000'::uuid
      and selection_policy = 'platform')
    or
    (version_scope = 'shop'
      and owner_store_key = store_id
      and selection_policy = 'shop')
  )
);

create index shipping_account_version_bindings_store_idx
  on public.shipping_account_version_store_bindings (store_id, provider_code);

alter table public.shipping_provider_account_versions owner to postgres;
alter table public.shipping_account_version_store_bindings owner to postgres;

alter table public.shipping_provider_account_versions enable row level security;
alter table public.shipping_account_version_store_bindings enable row level security;

-- All access, including service_role, goes through narrow SECURITY DEFINER RPCs.
revoke all privileges on table public.shipping_provider_account_versions,
  public.shipping_account_version_store_bindings
  from public, anon, authenticated, service_role;

create function public.guard_shipping_account_version_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent public.shipping_provider_accounts%rowtype;
begin
  select a.* into parent
  from public.shipping_provider_accounts a
  where a.id = new.account_id
  for share;

  if not found then
    raise exception 'shipping account not found' using errcode = '23503';
  end if;

  if (parent.provider_code, parent.environment, parent.scope, parent.store_id, parent.external_shop_id)
      is distinct from
     (new.provider_code, new.environment, new.scope, new.store_id, new.external_shop_id) then
    raise exception 'shipping account version identity does not match its parent'
      using errcode = '23514';
  end if;

  if new.id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'zero UUID cannot identify a shipping account version'
      using errcode = '23514';
  end if;

  if new.provider_code <> 'ghn' or new.environment <> 'staging' then
    raise exception 'GHN adapter does not support this provider environment'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create function public.guard_shipping_account_version_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.id, new.account_id, new.provider_code, new.environment, new.scope,
      new.store_id, new.external_shop_id, new.credential_ciphertext,
      new.encryption_key_version, new.credential_revision, new.created_at)
      is distinct from
     (old.id, old.account_id, old.provider_code, old.environment, old.scope,
      old.store_id, old.external_shop_id, old.credential_ciphertext,
      old.encryption_key_version, old.credential_revision, old.created_at) then
    raise exception 'shipping account version identity and credential are immutable'
      using errcode = '55000';
  end if;

  if old.revoked_at is not null
     and (new.revoked_at is distinct from old.revoked_at or new.enabled) then
    raise exception 'revoked shipping account version cannot be restored'
      using errcode = '55000';
  end if;

  if new.enabled and (new.verification_status <> 'verified' or new.revoked_at is not null) then
    raise exception 'only verified, non-revoked versions can be enabled'
      using errcode = '23514';
  end if;

  if new.revoked_at is not null and new.enabled then
    raise exception 'revoked version must be disabled'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create function public.guard_shipping_account_parent_identity_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.provider_code, new.environment, new.scope, new.store_id, new.external_shop_id)
      is distinct from
     (old.provider_code, old.environment, old.scope, old.store_id, old.external_shop_id)
     and exists (
       select 1 from public.shipping_provider_account_versions v
       where v.account_id = old.id
     ) then
    raise exception 'shipping account identity cannot change after a credential version exists'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create function public.deny_shipping_account_version_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'shipping account versions are retained permanently'
    using errcode = '55000';
end;
$$;

create function public.deny_shipping_account_version_binding_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'shipping account version bindings are immutable'
    using errcode = '55000';
end;
$$;

create trigger shipping_account_version_insert_guard
before insert on public.shipping_provider_account_versions
for each row execute function public.guard_shipping_account_version_insert();

create trigger shipping_account_version_update_guard
before update on public.shipping_provider_account_versions
for each row execute function public.guard_shipping_account_version_update();

-- UPDATE already holds a row lock; this trigger serializes identity changes
-- with the version INSERT trigger's FOR SHARE parent lock.
create trigger shipping_account_version_parent_identity_guard
before update of provider_code, environment, scope, store_id, external_shop_id
on public.shipping_provider_accounts
for each row execute function public.guard_shipping_account_parent_identity_update();

create trigger shipping_account_version_delete_guard
before delete on public.shipping_provider_account_versions
for each row execute function public.deny_shipping_account_version_delete();

create trigger shipping_account_version_binding_update_guard
before update or delete on public.shipping_account_version_store_bindings
for each row execute function public.deny_shipping_account_version_binding_mutation();

create function public.create_shipping_account_version(
  requested_version_id uuid,
  requested_account_id uuid,
  requested_provider_code text,
  requested_environment text,
  requested_scope text,
  requested_store_id uuid,
  requested_external_shop_id text,
  requested_ciphertext text,
  requested_key_version text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if requested_version_id is null
     or requested_version_id = '00000000-0000-0000-0000-000000000000'::uuid
     or requested_ciphertext is null
     or requested_key_version is null
     or left(requested_ciphertext, length(requested_key_version) + 1)
        <> requested_key_version || ':' then
    raise exception 'invalid shipping account version input' using errcode = '22023';
  end if;

  insert into public.shipping_provider_account_versions (
    id, account_id, provider_code, environment, scope, store_id,
    external_shop_id, credential_ciphertext, encryption_key_version
  ) values (
    requested_version_id, requested_account_id, requested_provider_code,
    requested_environment, requested_scope, requested_store_id,
    requested_external_shop_id, requested_ciphertext, requested_key_version
  );

  return requested_version_id;
end;
$$;

create function public.record_shipping_account_version_check(
  requested_version_id uuid,
  requested_result text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  version_row public.shipping_provider_account_versions%rowtype;
begin
  if requested_result is null or requested_result not in ('verified', 'failed') then
    raise exception 'invalid verification result' using errcode = '22023';
  end if;

  select v.* into version_row
  from public.shipping_provider_account_versions v
  where v.id = requested_version_id
  for update;
  if not found then
    raise exception 'shipping account version not found' using errcode = 'P0002';
  end if;
  if version_row.revoked_at is not null then
    raise exception 'revoked version cannot be verified' using errcode = '55000';
  end if;

  update public.shipping_provider_account_versions
  set verification_status = requested_result,
      enabled = case when requested_result = 'failed' then false else enabled end
  where id = requested_version_id;
  return requested_result;
end;
$$;

create function public.set_shipping_account_version_enabled(
  requested_version_id uuid,
  requested_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  version_row public.shipping_provider_account_versions%rowtype;
begin
  select v.* into version_row
  from public.shipping_provider_account_versions v
  where v.id = requested_version_id
  for update;
  if not found then
    raise exception 'shipping account version not found' using errcode = 'P0002';
  end if;
  if requested_enabled and (version_row.verification_status <> 'verified' or version_row.revoked_at is not null) then
    raise exception 'only verified, non-revoked versions can be enabled' using errcode = '55000';
  end if;

  update public.shipping_provider_account_versions
  set enabled = requested_enabled
  where id = requested_version_id;
  return requested_enabled;
end;
$$;

create function public.revoke_shipping_account_version(requested_version_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  revoked_time timestamptz;
begin
  perform 1
  from public.shipping_provider_account_versions v
  where v.id = requested_version_id
  for update;
  if not found then
    raise exception 'shipping account version not found' using errcode = 'P0002';
  end if;

  update public.shipping_provider_account_versions
  set enabled = false,
      revoked_at = coalesce(revoked_at, clock_timestamp())
  where id = requested_version_id
  returning revoked_at into revoked_time;
  return revoked_time;
end;
$$;

create function public.bind_shipping_account_version_to_store(
  requested_version_id uuid,
  requested_store_id uuid,
  requested_policy text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  version_row public.shipping_provider_account_versions%rowtype;
begin
  select v.* into version_row
  from public.shipping_provider_account_versions v
  where v.id = requested_version_id
  for update;
  if not found then
    raise exception 'shipping account version not found' using errcode = 'P0002';
  end if;
  if version_row.verification_status <> 'verified'
     or not version_row.enabled
     or version_row.revoked_at is not null then
    raise exception 'version is not selectable' using errcode = '55000';
  end if;
  if requested_policy is distinct from version_row.scope
     or (version_row.scope = 'shop' and version_row.store_id is distinct from requested_store_id) then
    raise exception 'version scope does not match store selection' using errcode = '23514';
  end if;

  insert into public.shipping_account_version_store_bindings (
    account_version_id, store_id, provider_code, version_scope,
    owner_store_key, selection_policy
  ) values (
    version_row.id, requested_store_id, version_row.provider_code,
    version_row.scope, version_row.owner_store_key, requested_policy
  ) on conflict (account_version_id, store_id, provider_code) do nothing;

  if not exists (
    select 1 from public.shipping_account_version_store_bindings b
    where b.account_version_id = version_row.id
      and b.store_id = requested_store_id
      and b.provider_code = version_row.provider_code
      and b.version_scope = version_row.scope
      and b.owner_store_key = version_row.owner_store_key
      and b.selection_policy = requested_policy
  ) then
    raise exception 'conflicting version store binding' using errcode = '23505';
  end if;
end;
$$;

-- Trigger functions are not callable as RPCs. Lifecycle table writes are RPC-only.
revoke all on function public.guard_shipping_account_version_insert(),
  public.guard_shipping_account_version_update(),
  public.guard_shipping_account_parent_identity_update(),
  public.deny_shipping_account_version_delete(),
  public.deny_shipping_account_version_binding_mutation()
  from public, anon, authenticated, service_role;

revoke all on function public.create_shipping_account_version(uuid, uuid, text, text, text, uuid, text, text, text),
  public.record_shipping_account_version_check(uuid, text),
  public.set_shipping_account_version_enabled(uuid, boolean),
  public.revoke_shipping_account_version(uuid),
  public.bind_shipping_account_version_to_store(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.create_shipping_account_version(uuid, uuid, text, text, text, uuid, text, text, text),
  public.record_shipping_account_version_check(uuid, text),
  public.set_shipping_account_version_enabled(uuid, boolean),
  public.revoke_shipping_account_version(uuid),
  public.bind_shipping_account_version_to_store(uuid, uuid, text)
  to service_role;

alter function public.guard_shipping_account_version_insert() owner to postgres;
alter function public.guard_shipping_account_version_update() owner to postgres;
alter function public.guard_shipping_account_parent_identity_update() owner to postgres;
alter function public.deny_shipping_account_version_delete() owner to postgres;
alter function public.deny_shipping_account_version_binding_mutation() owner to postgres;
alter function public.create_shipping_account_version(uuid, uuid, text, text, text, uuid, text, text, text) owner to postgres;
alter function public.record_shipping_account_version_check(uuid, text) owner to postgres;
alter function public.set_shipping_account_version_enabled(uuid, boolean) owner to postgres;
alter function public.revoke_shipping_account_version(uuid) owner to postgres;
alter function public.bind_shipping_account_version_to_store(uuid, uuid, text) owner to postgres;

commit;
