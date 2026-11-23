-- Run after 202611230002 on a disposable GrowDesk database. Fixtures are rolled back.
begin;

insert into auth.users (id, email, raw_app_meta_data) values
  ('41000000-0000-4000-8000-000000000001', 'shipping-platform@example.invalid', '{"account_kind":"platform_admin"}'),
  ('41000000-0000-4000-8000-000000000002', 'shipping-owner@example.invalid', '{}'),
  ('41000000-0000-4000-8000-000000000003', 'shipping-other@example.invalid', '{}');
insert into public.platform_admins (user_id) values ('41000000-0000-4000-8000-000000000001');
insert into public.stores (id, created_by, name, slug) values
  ('42000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000002', 'Shipping A', 'shipping-test-a'),
  ('42000000-0000-4000-8000-000000000003', '41000000-0000-4000-8000-000000000003', 'Shipping B', 'shipping-test-b');
insert into public.store_members (store_id, user_id, role) values
  ('42000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000002', 'owner'),
  ('42000000-0000-4000-8000-000000000003', '41000000-0000-4000-8000-000000000003', 'owner');

set local role service_role;
insert into public.shipping_provider_accounts
  (id, provider_code, scope, store_id, name, environment, external_shop_id, credential_ciphertext)
values
  ('43000000-0000-4000-8000-000000000001', 'ghn', 'platform', null, 'Test GrowDesk', 'sandbox', '950001', 'v1:AA==:AA==:AA=='),
  ('43000000-0000-4000-8000-000000000002', 'ghn', 'shop', '42000000-0000-4000-8000-000000000002', 'Test Shop A', 'sandbox', '950002', null),
  ('43000000-0000-4000-8000-000000000003', 'ghn', 'shop', '42000000-0000-4000-8000-000000000003', 'Test Shop B', 'sandbox', '950003', null);

do $$
declare
  account_id constant uuid := '43000000-0000-4000-8000-000000000001';
  admin_id constant uuid := '41000000-0000-4000-8000-000000000001';
  owner_id constant uuid := '41000000-0000-4000-8000-000000000002';
  claim jsonb;
  old_check uuid;
  new_check uuid;
  revision uuid;
  changed_field text;
begin
  begin
    insert into public.shipping_providers (code, name) values ('ghn', 'Duplicate');
    raise exception 'duplicate provider accepted';
  exception when unique_violation then null;
  end;
  begin
    update public.shipping_providers set integration_enabled = true where code = 'ghtk';
    raise exception 'unsupported integration enabled';
  exception when check_violation then null;
  end;
  begin
    update public.shipping_provider_accounts set enabled = true where id = account_id;
    raise exception 'unverified account enabled';
  exception when check_violation then null;
  end;
  begin
    perform public.begin_shipping_account_check(account_id, owner_id);
    raise exception 'non-admin actor accepted by check RPC';
  exception when insufficient_privilege then null;
  end;
  if public.begin_shipping_account_check('43000000-0000-4000-8000-000000000002', admin_id)->>'state' <> 'missing' then
    raise exception 'platform checker accepted shop account';
  end if;

  foreach changed_field in array array['credential_ciphertext', 'external_shop_id', 'provider_code', 'environment'] loop
    claim := public.begin_shipping_account_check(account_id, admin_id);
    old_check := (claim->>'id')::uuid;
    revision := (claim->>'revision')::uuid;
    if old_check is null or public.begin_shipping_account_check(account_id, admin_id)->>'state' <> 'busy' then
      raise exception 'check lease/cooldown failed';
    end if;
    case changed_field
      when 'credential_ciphertext' then
        update public.shipping_provider_accounts set credential_ciphertext = 'v2:AA==:AA==:AA==' where id = account_id;
      when 'external_shop_id' then
        update public.shipping_provider_accounts set external_shop_id = '950004' where id = account_id;
        if exists (select 1 from public.shipping_provider_accounts a where a.id = account_id and a.credential_ciphertext is not null) then
          raise exception 'old token retained after Shop ID change';
        end if;
      when 'provider_code' then
        update public.shipping_provider_accounts set provider_code = 'ghtk' where id = account_id;
      when 'environment' then
        update public.shipping_provider_accounts set environment = 'simulation' where id = account_id;
    end case;
    if not exists (select 1 from public.shipping_provider_accounts a where a.id = account_id
        and a.config_revision <> revision and a.connection_status = 'not_configured' and a.last_checked_at is null) then
      raise exception 'revision or status did not change for %', changed_field;
    end if;
    if public.finish_shipping_account_check(account_id, old_check, 'verified', null) <> 'superseded' then
      raise exception 'stale result was applied after % change', changed_field;
    end if;
    update public.shipping_account_checks c set started_at = started_at - interval '31 seconds' where c.id = old_check;
  end loop;

  update public.shipping_provider_accounts set provider_code = 'ghn', environment = 'sandbox',
    credential_ciphertext = 'v3:AA==:AA==:AA==' where id = account_id;
  old_check := (public.begin_shipping_account_check(account_id, admin_id)->>'id')::uuid;
  update public.shipping_account_checks c set started_at = started_at - interval '4 minutes' where c.id = old_check;
  if public.finish_shipping_account_check(account_id, old_check, 'verified', null) <> 'expired' then
    raise exception 'late response was accepted before the cron job ran';
  end if;

  old_check := (public.begin_shipping_account_check(account_id, admin_id)->>'id')::uuid;
  update public.shipping_account_checks c set started_at = started_at - interval '4 minutes' where c.id = old_check;
  reset role;
  perform public.expire_shipping_account_checks();
  set local role service_role;
  if not exists (select 1 from public.shipping_account_checks c where c.id = old_check
     and c.result = 'failed' and c.error_code = 'CHECK_EXPIRED' and c.finished_at is not null) then
    raise exception 'orphaned attempt was not expired';
  end if;

  new_check := (public.begin_shipping_account_check(account_id, admin_id)->>'id')::uuid;
  if new_check is null or public.finish_shipping_account_check(account_id, new_check, 'verified', null) <> 'verified' then
    raise exception 'new valid response was not applied';
  end if;
  if public.finish_shipping_account_check(account_id, old_check, 'failed', 'PROVIDER_UNAVAILABLE') <> 'expired'
      or public.finish_shipping_account_check(account_id, new_check, 'failed', 'PROVIDER_UNAVAILABLE') <> 'already_finished'
      or public.finish_shipping_account_check(account_id, gen_random_uuid(), 'verified', null) <> 'missing' then
    raise exception 'stale, finished or missing check returned the wrong state';
  end if;
  if not exists (select 1 from public.shipping_provider_accounts a where a.id = account_id and a.connection_status = 'verified') then
    raise exception 'late result overwrote latest status';
  end if;

  update public.shipping_provider_accounts set enabled = true where id = account_id;
  update public.shipping_account_checks c set started_at = started_at - interval '31 seconds' where c.id = new_check;
  old_check := (public.begin_shipping_account_check(account_id, admin_id)->>'id')::uuid;
  update public.shipping_provider_accounts set enabled = false where id = account_id;
  if public.finish_shipping_account_check(account_id, old_check, 'verified', null) <> 'superseded'
    or exists (select 1 from public.shipping_provider_accounts a where a.id = account_id and a.enabled) then
    raise exception 'a disabled account accepted an in-flight check';
  end if;

  update public.shipping_account_checks c set started_at = started_at - interval '31 seconds' where c.id = old_check;
  update public.shipping_provider_accounts set enabled = true where id = account_id;
  old_check := (public.begin_shipping_account_check(account_id, admin_id)->>'id')::uuid;
  update public.shipping_providers set catalog_enabled = false where code = 'ghn';
  if public.finish_shipping_account_check(account_id, old_check, 'verified', null) <> 'provider_disabled' then
    raise exception 'check completed against a disabled provider';
  end if;
  if not exists (select 1 from public.shipping_provider_accounts a where a.id = account_id
      and a.enabled and a.connection_status = 'verified') then
    raise exception 'catalog disable modified historical account status';
  end if;
  update public.shipping_provider_accounts set enabled = false where id = account_id;
  begin
    update public.shipping_provider_accounts set enabled = true where id = account_id;
    raise exception 'account activated with disabled provider';
  exception when check_violation then null;
  end;

  begin
    update public.shipping_account_checks c set error_code = null where c.id = old_check
      and c.result = 'not_configured';
    update public.shipping_account_checks c set result = 'failed' where c.id = old_check;
    raise exception 'failed check accepted null error code';
  exception when check_violation then null;
  end;
  begin
    update public.shipping_account_checks c set error_code = 'PROVIDER_TIMEOUT' where c.id = new_check;
    raise exception 'verified check accepted an error code';
  exception when check_violation then null;
  end;
end;
$$;
reset role;

set local role anon;
do $$
begin
  if has_table_privilege(current_user, 'public.shipping_providers', 'SELECT')
    or has_column_privilege(current_user, 'public.shipping_provider_accounts', 'id', 'SELECT')
    or has_function_privilege(current_user, 'public.begin_shipping_account_check(uuid,uuid)', 'EXECUTE') then
    raise exception 'anonymous account has shipping privileges';
  end if;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '41000000-0000-4000-8000-000000000002', true);
do $$
begin
  if exists (select code from public.shipping_providers)
    or exists (select id from public.shipping_provider_accounts)
    or exists (select id from public.shipping_account_checks) then
    raise exception 'shop owner sees restricted shipping records';
  end if;
  begin
    update public.shipping_provider_accounts set name = 'Unauthorized' where id = '43000000-0000-4000-8000-000000000001';
    raise exception 'shop owner can update platform account';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.begin_shipping_account_check('43000000-0000-4000-8000-000000000001', null);
    raise exception 'shop owner can claim platform check';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '41000000-0000-4000-8000-000000000001', true);
do $$
begin
  if (select count(id) from public.shipping_provider_accounts
      where id in ('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000002',
        '43000000-0000-4000-8000-000000000003')) <> 3 then
    raise exception 'platform admin cannot read shipping metadata';
  end if;
  if not exists (select id from public.shipping_account_checks
    where account_id = '43000000-0000-4000-8000-000000000001' and result = 'superseded') then
    raise exception 'platform admin cannot read check history';
  end if;
  begin
    perform credential_ciphertext from public.shipping_provider_accounts;
    raise exception 'browser role can read credential ciphertext';
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;
