begin;

-- Normalize existing history without changing the outcome of any completed check.
update public.shipping_account_checks
set error_code = case
  when result in ('running', 'verified') then null
  when result = 'superseded' then 'CONFIG_CHANGED'
  when result = 'failed' and error_code not in (
    'INVALID_TOKEN', 'SHOP_ACCESS_DENIED', 'SHOP_NOT_FOUND', 'PROVIDER_UNAVAILABLE', 'CHECK_EXPIRED'
  ) then 'PROVIDER_UNAVAILABLE'
  when result = 'failed' then coalesce(error_code, 'PROVIDER_UNAVAILABLE')
  when error_code in ('CHECK_DISABLED', 'UNSUPPORTED', 'PROVIDER_DISABLED', 'TOKEN_MISSING', 'KEY_UNAVAILABLE')
    then error_code
  else null
end;

alter table public.shipping_account_checks
  drop constraint shipping_account_checks_error_code_check,
  add constraint shipping_account_checks_outcome_check check ((
    case result
      when 'running' then error_code is null
      when 'verified' then error_code is null
      when 'failed' then error_code in (
        'INVALID_TOKEN', 'SHOP_ACCESS_DENIED', 'SHOP_NOT_FOUND', 'PROVIDER_UNAVAILABLE',
        'PROVIDER_TIMEOUT', 'CHECK_EXPIRED'
      )
      when 'not_configured' then error_code is null or error_code in (
        'CHECK_DISABLED', 'UNSUPPORTED', 'PROVIDER_DISABLED', 'TOKEN_MISSING', 'KEY_UNAVAILABLE'
      )
      when 'superseded' then error_code = 'CONFIG_CHANGED'
    end
  ) is true);

create index shipping_checks_running_started_idx
  on public.shipping_account_checks (started_at) where result = 'running';

-- This job only touches history, so it cannot override an account's latest result.
create function public.expire_shipping_account_checks()
returns void language sql set search_path = '' as $$
  update public.shipping_account_checks
  set result = 'failed', error_code = 'CHECK_EXPIRED', finished_at = statement_timestamp()
  where result = 'running' and started_at <= statement_timestamp() - interval '3 minutes';
$$;
revoke all on function public.expire_shipping_account_checks() from public, anon, authenticated;

select public.expire_shipping_account_checks();
-- Claims from before this migration were not protected by the configuration trigger.
update public.shipping_account_checks
set result = 'superseded', error_code = 'CONFIG_CHANGED', finished_at = clock_timestamp()
where result = 'running';

create unique index shipping_checks_one_running_per_account_idx
  on public.shipping_account_checks (account_id) where result = 'running';

create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule(
  'growdesk-expire-shipping-account-checks',
  '* * * * *',
  'select public.expire_shipping_account_checks()'
);

create function public.guard_shipping_account_update()
returns trigger language plpgsql set search_path = '' as $$
declare
  config_changed boolean := false;
  catalog_active boolean;
  changed_at timestamptz;
begin
  if tg_op = 'UPDATE' then
    config_changed := (new.provider_code, new.environment, new.external_shop_id, new.credential_ciphertext)
      is distinct from (old.provider_code, old.environment, old.external_shop_id, old.credential_ciphertext);
    -- Only the database assigns a new revision.
    new.config_revision := old.config_revision;
    if config_changed then
      if (new.provider_code, new.environment, new.external_shop_id)
        is distinct from (old.provider_code, old.environment, old.external_shop_id)
        and new.credential_ciphertext is not distinct from old.credential_ciphertext then
        new.credential_ciphertext := null;
      end if;
      new.enabled := false;
      new.connection_status := 'not_configured';
      new.last_checked_at := null;
    end if;

    if config_changed or (old.enabled and not new.enabled) then
      new.config_revision := gen_random_uuid();
      changed_at := clock_timestamp();
      update public.shipping_account_checks
      set result = case when started_at <= changed_at - interval '3 minutes' then 'failed' else 'superseded' end,
        error_code = case when started_at <= changed_at - interval '3 minutes' then 'CHECK_EXPIRED' else 'CONFIG_CHANGED' end,
        finished_at = changed_at
      where account_id = old.id and result = 'running';
    end if;
  end if;

  if new.enabled and (tg_op = 'INSERT' or not old.enabled) then
    -- Serialize activation with a catalog update. A normal UPDATE takes a conflicting lock.
    select p.catalog_enabled into catalog_active
    from public.shipping_providers p where p.code = new.provider_code for share;
    if catalog_active is not true then
      raise exception using errcode = '23514', constraint = 'shipping_account_provider_catalog_enabled',
        message = 'shipping_account_provider_catalog_enabled';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_shipping_account_update() from public, anon, authenticated;
create trigger shipping_account_update_guard
before insert or update on public.shipping_provider_accounts
for each row execute function public.guard_shipping_account_update();

drop function public.begin_shipping_account_check(uuid, uuid);
create function public.begin_shipping_account_check(target_id uuid, actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  revision uuid;
  check_id uuid;
  claimed_at timestamptz;
begin
  if not exists (select 1 from public.platform_admins where user_id = actor) then
    raise exception 'actor is not a platform admin' using errcode = '42501';
  end if;

  select a.config_revision into revision
  from public.shipping_provider_accounts a
  where a.id = target_id and a.scope = 'platform' for update;
  if not found then return jsonb_build_object('state', 'missing'); end if;

  claimed_at := clock_timestamp();
  update public.shipping_account_checks
  set result = 'failed', error_code = 'CHECK_EXPIRED', finished_at = claimed_at
  where account_id = target_id and result = 'running' and started_at <= claimed_at - interval '3 minutes';

  if exists (
    select 1 from public.shipping_account_checks c
    where c.account_id = target_id
      and (c.started_at > claimed_at - interval '30 seconds' or c.result = 'running')
  ) then return jsonb_build_object('state', 'busy'); end if;

  insert into public.shipping_account_checks (account_id, config_revision, actor_id, started_at)
  values (target_id, revision, actor, claimed_at) returning id into check_id;
  return jsonb_build_object('state', 'claimed', 'id', check_id, 'revision', revision);
end;
$$;

create or replace function public.finish_shipping_account_check(
  target_id uuid, check_id uuid, check_result text, failure_code text
) returns text language plpgsql set search_path = '' as $$
declare
  account public.shipping_provider_accounts%rowtype;
  attempt public.shipping_account_checks%rowtype;
  completed_at timestamptz;
  catalog_active boolean;
  disposition text;
begin
  if check_result is null or check_result not in ('verified', 'failed', 'not_configured') then
    raise exception 'invalid check result' using errcode = '22023';
  end if;

  select a.* into account from public.shipping_provider_accounts a
  where a.id = target_id and a.scope = 'platform' for update;
  if not found then return 'missing'; end if;

  select p.catalog_enabled into catalog_active
  from public.shipping_providers p where p.code = account.provider_code for share;

  select c.* into attempt from public.shipping_account_checks c
  where c.id = check_id and c.account_id = target_id for update;
  if not found then return 'missing'; end if;
  if attempt.result = 'superseded' then return 'superseded'; end if;
  if attempt.error_code = 'CHECK_EXPIRED' then return 'expired'; end if;
  if attempt.result <> 'running' then return 'already_finished'; end if;

  completed_at := clock_timestamp();
  if attempt.started_at <= completed_at - interval '3 minutes' then
    check_result := 'failed';
    failure_code := 'CHECK_EXPIRED';
    disposition := 'expired';
  elsif attempt.config_revision <> account.config_revision then
    check_result := 'superseded';
    failure_code := 'CONFIG_CHANGED';
    disposition := 'superseded';
  elsif catalog_active is not true then
    check_result := 'not_configured';
    failure_code := 'PROVIDER_DISABLED';
    disposition := 'provider_disabled';
  else
    disposition := check_result;
  end if;

  update public.shipping_account_checks
  set result = check_result, error_code = failure_code, finished_at = completed_at
  where id = check_id;

  if disposition in ('verified', 'failed', 'not_configured') then
    update public.shipping_provider_accounts
    set last_checked_at = completed_at, connection_status = check_result, enabled = enabled and check_result = 'verified'
    where id = target_id;
  end if;
  return disposition;
end;
$$;

revoke all on function public.begin_shipping_account_check(uuid, uuid),
  public.finish_shipping_account_check(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.begin_shipping_account_check(uuid, uuid),
  public.finish_shipping_account_check(uuid, uuid, text, text) to service_role;

commit;
