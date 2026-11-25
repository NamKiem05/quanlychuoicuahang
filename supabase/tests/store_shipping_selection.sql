-- Run on a disposable local database after migration 202611230007.
begin;

insert into auth.users (id, email, raw_app_meta_data) values
  ('61000000-0000-4000-8000-000000000001', 'shipping-owner-a@example.invalid', '{}'),
  ('61000000-0000-4000-8000-000000000002', 'shipping-owner-b@example.invalid', '{}');
insert into public.stores (id, created_by, name, slug) values
  ('62000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'Shipping A', 'shipping-selection-a'),
  ('62000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000002', 'Shipping B', 'shipping-selection-b');
insert into public.store_members (store_id, user_id, role) values
  ('62000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'owner'),
  ('62000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000002', 'staff'),
  ('62000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000002', 'owner');

set local role service_role;
update public.shipping_providers set catalog_enabled = true where code = 'ghn';
insert into public.shipping_provider_accounts (id, provider_code, scope, store_id, name, environment, external_shop_id) values
  ('63000000-0000-4000-8000-000000000001', 'ghn', 'shop', '62000000-0000-4000-8000-000000000001', 'Shop A', 'staging', '980001'),
  ('63000000-0000-4000-8000-000000000002', 'ghn', 'shop', '62000000-0000-4000-8000-000000000002', 'Shop B', 'staging', '980002'),
  ('63000000-0000-4000-8000-000000000003', 'ghn', 'platform', null, 'Platform', 'staging', '980003');

do $$
declare
  owner_a constant uuid := '61000000-0000-4000-8000-000000000001';
  owner_b constant uuid := '61000000-0000-4000-8000-000000000002';
  store_a constant uuid := '62000000-0000-4000-8000-000000000001';
  store_b constant uuid := '62000000-0000-4000-8000-000000000002';
  version_a constant uuid := '64000000-0000-4000-8000-000000000001';
  version_b constant uuid := '64000000-0000-4000-8000-000000000002';
  platform_version constant uuid := '64000000-0000-4000-8000-000000000003';
  configuration jsonb;
  saved_revision uuid;
begin
  perform public.create_shipping_account_version(version_a, '63000000-0000-4000-8000-000000000001', 'ghn', 'staging', 'shop', store_a, '980001', 'v1:AA==:AA==:AA==', 'v1');
  perform public.create_shipping_account_version(version_b, '63000000-0000-4000-8000-000000000002', 'ghn', 'staging', 'shop', store_b, '980002', 'v1:AA==:AA==:AA==', 'v1');
  perform public.create_shipping_account_version(platform_version, '63000000-0000-4000-8000-000000000003', 'ghn', 'staging', 'platform', null, '980003', 'v1:AA==:AA==:AA==', 'v1');

  if public.get_store_shipping_configuration(store_b, owner_a) is not null
     or public.get_store_shipping_configuration(store_a, owner_b) is not null
     or public.select_store_shipping_account(store_a, owner_b, version_a, null) is distinct from 'forbidden'
     or public.select_store_shipping_account(store_b, owner_a, version_b, null) is distinct from 'forbidden' then
    raise exception 'cross-store or staff access was allowed';
  end if;
  configuration := public.get_store_shipping_configuration(store_a, owner_a);
  if jsonb_array_length(configuration->'accounts') is distinct from 1
     or configuration#>>'{accounts,0,id}' is distinct from version_a::text
     or configuration#>>'{accounts,0,status}' is distinct from 'not_checked'
     or configuration::text ~ 'credential|ciphertext|v1:AA==' then
    raise exception 'unexpected account visibility or credential metadata';
  end if;
  if public.select_store_shipping_account(store_a, owner_a, version_a, null) is distinct from 'unavailable'
     or public.select_store_shipping_account(store_a, owner_a, version_b, null) is distinct from 'unavailable' then
    raise exception 'unverified or foreign-shop version was selectable';
  end if;

  perform public.record_shipping_account_version_check(version_a, 'verified');
  perform public.set_shipping_account_version_enabled(version_a, true);
  perform public.record_shipping_account_version_check(platform_version, 'verified');
  perform public.set_shipping_account_version_enabled(platform_version, true);
  if public.select_store_shipping_account(store_a, owner_a, platform_version, null) is distinct from 'unavailable' then
    raise exception 'platform version was selected without a grant';
  end if;
  perform public.bind_shipping_account_version_to_store(platform_version, store_a, 'platform');
  if public.select_store_shipping_account(store_a, owner_a, version_a, null) is distinct from 'saved' then
    raise exception 'shop version was not selected';
  end if;
  configuration := public.get_store_shipping_configuration(store_a, owner_a);
  saved_revision := (configuration->>'revision')::uuid;
  if configuration->>'selectedVersionId' is distinct from version_a::text or saved_revision is null
     or jsonb_array_length(configuration->'accounts') is distinct from 2 then
    raise exception 'shop selection or scoped platform grant was not returned';
  end if;
  if public.select_store_shipping_account(store_a, owner_a, version_a, null) is distinct from 'saved'
     or public.select_store_shipping_account(store_a, owner_a, platform_version, null) is distinct from 'conflict' then
    raise exception 'duplicate submission or stale update was not handled';
  end if;
  if public.select_store_shipping_account(store_a, owner_a, platform_version, saved_revision) is distinct from 'saved' then
    raise exception 'granted platform version was not selected';
  end if;
  perform public.revoke_shipping_account_version(platform_version);
  if public.select_store_shipping_account(store_a, owner_a, platform_version, saved_revision) is distinct from 'unavailable' then
    raise exception 'revoked version remained selectable';
  end if;
  update public.shipping_providers set catalog_enabled = false where code = 'ghn';
  if public.select_store_shipping_account(store_a, owner_a, version_a, saved_revision) is distinct from 'unavailable' then
    raise exception 'disabled provider remained selectable';
  end if;
end;
$$;

reset role;
do $$
begin
  if (select count(*) from public.shipping_account_version_store_bindings
      where store_id = '62000000-0000-4000-8000-000000000001') <> 2 then
    raise exception 'binding history was duplicated or lost';
  end if;
  if has_function_privilege('authenticated', 'public.select_store_shipping_account(uuid,uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_store_shipping_configuration(uuid,uuid)', 'EXECUTE')
     or has_table_privilege('service_role', 'public.store_shipping_selections', 'UPDATE') then
    raise exception 'selection privileges bypass the intended RPC boundary';
  end if;
end;
$$;

rollback;
