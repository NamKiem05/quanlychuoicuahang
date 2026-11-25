-- Run after migrations 202611230001 through 202611230006 on a disposable
-- GrowDesk PostgreSQL database. Fixtures are rolled back; no provider calls are made.
begin;

insert into auth.users (id, email, raw_app_meta_data) values
  ('51000000-0000-4000-8000-000000000001', 'version-owner-a@example.invalid', '{}'),
  ('51000000-0000-4000-8000-000000000002', 'version-owner-b@example.invalid', '{}');

insert into public.stores (id, created_by, name, slug) values
  ('52000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 'Version A', 'version-test-a'),
  ('52000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000002', 'Version B', 'version-test-b');

insert into public.store_members (store_id, user_id, role) values
  ('52000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 'owner'),
  ('52000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000002', 'owner');

set local role service_role;
insert into public.shipping_provider_accounts
  (id, provider_code, scope, store_id, name, environment, external_shop_id)
values
  ('53000000-0000-4000-8000-000000000001', 'ghn', 'shop', '52000000-0000-4000-8000-000000000001', 'Version shop A', 'staging', '960001'),
  ('53000000-0000-4000-8000-000000000002', 'ghn', 'shop', '52000000-0000-4000-8000-000000000002', 'Version shop B', 'staging', '960002'),
  ('53000000-0000-4000-8000-000000000003', 'ghn', 'platform', null, 'Version platform', 'staging', '960003');

do $$
declare
  version_a constant uuid := '54000000-0000-4000-8000-000000000001';
  version_b constant uuid := '54000000-0000-4000-8000-000000000002';
  version_platform constant uuid := '54000000-0000-4000-8000-000000000003';
  rejected boolean;
  secret text;
begin
  -- Creation starts unverified and disabled. Ciphertext prefix/key version must match.
  perform public.create_shipping_account_version(
    version_a, '53000000-0000-4000-8000-000000000001', 'ghn', 'staging', 'shop',
    '52000000-0000-4000-8000-000000000001', '960001', 'v1:AA==:AA==:AA==', 'v1'
  );
  perform public.create_shipping_account_version(
    version_b, '53000000-0000-4000-8000-000000000002', 'ghn', 'staging', 'shop',
    '52000000-0000-4000-8000-000000000002', '960002', 'v1:AA==:AA==:AA==', 'v1'
  );
  perform public.create_shipping_account_version(
    version_platform, '53000000-0000-4000-8000-000000000003', 'ghn', 'staging', 'platform',
    null, '960003', 'v1:AA==:AA==:AA==', 'v1'
  );

  rejected := false;
  begin
    perform public.create_shipping_account_version(
      '00000000-0000-0000-0000-000000000000', '53000000-0000-4000-8000-000000000001',
      'ghn', 'staging', 'shop', '52000000-0000-4000-8000-000000000001',
      '960001', 'v1:AA==:AA==:AA==', 'v1'
    );
  exception when invalid_parameter_value then rejected := true;
  end;
  if not rejected then raise exception 'zero UUID version id was accepted'; end if;

  rejected := false;
  begin
    perform public.create_shipping_account_version(
      gen_random_uuid(), '53000000-0000-4000-8000-000000000001',
      'ghn', 'staging', 'shop', '52000000-0000-4000-8000-000000000001',
      '960001', 'v2:AA==:AA==:AA==', 'v1'
    );
  exception when invalid_parameter_value then rejected := true;
  end;
  if not rejected then raise exception 'ciphertext/key version prefix mismatch was accepted'; end if;

  rejected := false;
  begin
    perform public.create_shipping_account_version(
      gen_random_uuid(), '53000000-0000-4000-8000-000000000001',
      'ghn', 'sandbox', 'shop', '52000000-0000-4000-8000-000000000001',
      '960001', 'v1:AA==:AA==:AA==', 'v1'
    );
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'unsupported sandbox version was accepted'; end if;

  rejected := false;
  begin
    perform public.create_shipping_account_version(
      gen_random_uuid(), '53000000-0000-4000-8000-000000000001',
      'ghn', 'staging', 'shop', '52000000-0000-4000-8000-000000000002',
      '960001', 'v1:AA==:AA==:AA==', 'v1'
    );
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'parent identity mismatch was accepted'; end if;

  -- Unverified and failed versions cannot be enabled. A failed recheck disables an enabled version.
  rejected := false;
  begin
    perform public.set_shipping_account_version_enabled(version_a, true);
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then raise exception 'unverified version was enabled'; end if;

  perform public.record_shipping_account_version_check(version_a, 'failed');
  rejected := false;
  begin
    perform public.set_shipping_account_version_enabled(version_a, true);
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then raise exception 'failed version was enabled'; end if;

  perform public.record_shipping_account_version_check(version_a, 'verified');
  if public.set_shipping_account_version_enabled(version_a, true) is not true then
    raise exception 'verified version could not be enabled';
  end if;
  perform public.record_shipping_account_version_check(version_a, 'failed');
  rejected := false;
  begin
    perform public.set_shipping_account_version_enabled(version_a, true);
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then raise exception 'version remained enableable after failed verification'; end if;
end;
$$;
reset role;

do $$
begin
  if not exists (
    select 1 from public.shipping_provider_account_versions v
    where v.id = '54000000-0000-4000-8000-000000000001'
      and v.verification_status = 'failed' and not v.enabled
  ) then
    raise exception 'failed verification did not disable the version';
  end if;
end;
$$;
set local role service_role;

do $$
declare
  version_a constant uuid := '54000000-0000-4000-8000-000000000001';
  version_b constant uuid := '54000000-0000-4000-8000-000000000002';
  version_platform constant uuid := '54000000-0000-4000-8000-000000000003';
  rejected boolean;
  secret text;
begin
  -- Restore and enable for binding tests.
  perform public.record_shipping_account_version_check(version_a, 'verified');
  perform public.set_shipping_account_version_enabled(version_a, true);
  perform public.record_shipping_account_version_check(version_platform, 'verified');
  perform public.set_shipping_account_version_enabled(version_platform, true);
  perform public.bind_shipping_account_version_to_store(
    version_a, '52000000-0000-4000-8000-000000000001', 'shop'
  );
  perform public.bind_shipping_account_version_to_store(
    version_platform, '52000000-0000-4000-8000-000000000001', 'platform'
  );
  perform public.bind_shipping_account_version_to_store(
    version_platform, '52000000-0000-4000-8000-000000000002', 'platform'
  );

  rejected := false;
  begin
    perform public.bind_shipping_account_version_to_store(
      version_a, '52000000-0000-4000-8000-000000000002', 'shop'
    );
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'shop version was bound to a different store'; end if;

  rejected := false;
  begin
    perform public.bind_shipping_account_version_to_store(
      version_platform, '52000000-0000-4000-8000-000000000001', 'shop'
    );
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'platform version accepted shop selection policy'; end if;

  -- service_role has no direct SELECT/DML, including ciphertext reads.
  if has_table_privilege(current_user, 'public.shipping_provider_account_versions', 'SELECT')
     or has_table_privilege(current_user, 'public.shipping_provider_account_versions', 'INSERT')
     or has_table_privilege(current_user, 'public.shipping_provider_account_versions', 'UPDATE')
     or has_table_privilege(current_user, 'public.shipping_provider_account_versions', 'DELETE')
     or has_table_privilege(current_user, 'public.shipping_provider_account_versions', 'TRUNCATE')
     or has_table_privilege(current_user, 'public.shipping_account_version_store_bindings', 'SELECT')
     or has_table_privilege(current_user, 'public.shipping_account_version_store_bindings', 'INSERT')
     or has_table_privilege(current_user, 'public.shipping_account_version_store_bindings', 'UPDATE')
     or has_table_privilege(current_user, 'public.shipping_account_version_store_bindings', 'DELETE')
     or has_table_privilege(current_user, 'public.shipping_account_version_store_bindings', 'TRUNCATE') then
    raise exception 'service_role has direct version table privileges';
  end if;
  rejected := false;
  begin
    select v.credential_ciphertext into secret
    from public.shipping_provider_account_versions v where v.id = version_a;
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'service_role selected ciphertext directly'; end if;
  rejected := false;
  begin
    update public.shipping_provider_account_versions set enabled = false where id = version_a;
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'service_role updated lifecycle directly'; end if;

  -- Public/client roles cannot call any lifecycle or binding RPC.
  if has_function_privilege('anon', 'public.create_shipping_account_version(uuid,uuid,text,text,text,uuid,text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.create_shipping_account_version(uuid,uuid,text,text,text,uuid,text,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_shipping_account_version_check(uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_shipping_account_version_check(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_shipping_account_version_enabled(uuid,boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.set_shipping_account_version_enabled(uuid,boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.revoke_shipping_account_version(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.revoke_shipping_account_version(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.bind_shipping_account_version_to_store(uuid,uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.bind_shipping_account_version_to_store(uuid,uuid,text)', 'EXECUTE') then
    raise exception 'anon/authenticated can execute a restricted RPC';
  end if;

  perform public.revoke_shipping_account_version(version_a);
  rejected := false;
  begin
    perform public.record_shipping_account_version_check(version_a, 'verified');
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then raise exception 'revoked version was verified again'; end if;

  rejected := false;
  begin
    perform public.bind_shipping_account_version_to_store(
      version_a, '52000000-0000-4000-8000-000000000001', 'shop'
    );
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then raise exception 'revoked version was newly bound'; end if;
end;
$$;
reset role;

-- Parent identity becomes immutable once any version exists; display name remains mutable.
do $$
declare
  parent_id constant uuid := '53000000-0000-4000-8000-000000000001';
  rejected boolean;
begin
  update public.shipping_provider_accounts set name = 'Renamed metadata only' where id = parent_id;
  if not exists (select 1 from public.shipping_provider_accounts where id = parent_id and name = 'Renamed metadata only') then
    raise exception 'non-identity metadata update was rejected';
  end if;

  rejected := false;
  begin
    update public.shipping_provider_accounts set provider_code = 'ghtk' where id = parent_id;
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then raise exception 'parent provider_code identity change was accepted'; end if;

  rejected := false;
  begin
    update public.shipping_provider_accounts set environment = 'sandbox' where id = parent_id;
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then raise exception 'parent environment identity change was accepted'; end if;

  rejected := false;
  begin
    update public.shipping_provider_accounts set scope = 'platform' where id = parent_id;
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then raise exception 'parent scope identity change was accepted'; end if;

  rejected := false;
  begin
    update public.shipping_provider_accounts set store_id = '52000000-0000-4000-8000-000000000002' where id = parent_id;
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then raise exception 'parent store_id identity change was accepted'; end if;

  rejected := false;
  begin
    update public.shipping_provider_accounts set external_shop_id = '969999' where id = parent_id;
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then raise exception 'parent external_shop_id identity change was accepted'; end if;
end;
$$;

-- Verify binding CHECK/FK guards separately from RPC input validation.
do $$
declare
  rejected boolean;
begin
  rejected := false;
  begin
    insert into public.shipping_account_version_store_bindings
      (account_version_id, store_id, provider_code, version_scope, owner_store_key, selection_policy)
    values ('54000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000002',
      'ghn', 'shop', '52000000-0000-4000-8000-000000000002', 'shop');
  exception when foreign_key_violation then rejected := true;
  end;
  if not rejected then raise exception 'binding with wrong owner_store_key/store was accepted'; end if;

  rejected := false;
  begin
    insert into public.shipping_account_version_store_bindings
      (account_version_id, store_id, provider_code, version_scope, owner_store_key, selection_policy)
    values ('54000000-0000-4000-8000-000000000002', '52000000-0000-4000-8000-000000000001',
      'ghn', 'platform', '00000000-0000-0000-0000-000000000000', 'platform');
  exception when foreign_key_violation then rejected := true;
  end;
  if not rejected then raise exception 'binding with wrong scope was accepted'; end if;

  rejected := false;
  begin
    insert into public.shipping_account_version_store_bindings
      (account_version_id, store_id, provider_code, version_scope, owner_store_key, selection_policy)
    values ('54000000-0000-4000-8000-000000000002', '52000000-0000-4000-8000-000000000002',
      'ghn', 'shop', '52000000-0000-4000-8000-000000000002', 'platform');
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'binding with wrong selection_policy was accepted'; end if;

  rejected := false;
  begin
    update public.shipping_account_version_store_bindings
      set selection_policy = 'platform'
    where account_version_id = '54000000-0000-4000-8000-000000000001';
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then raise exception 'binding update was accepted'; end if;

  rejected := false;
  begin
    delete from public.shipping_account_version_store_bindings
    where account_version_id = '54000000-0000-4000-8000-000000000001';
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then raise exception 'binding delete was accepted'; end if;
end;
$$;

-- Revocation is one-way; immutable history cannot be deleted even by the owner.
do $$
declare
  rejected boolean;
begin
  rejected := false;
  begin
    update public.shipping_provider_account_versions set revoked_at = null
    where id = '54000000-0000-4000-8000-000000000001';
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then raise exception 'revoked_at was cleared'; end if;

  rejected := false;
  begin
    update public.shipping_provider_account_versions
      set revoked_at = '2000-01-01T00:00:00Z'::timestamptz
    where id = '54000000-0000-4000-8000-000000000001';
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then raise exception 'revoked_at was changed'; end if;

  rejected := false;
  begin
    delete from public.shipping_provider_account_versions
    where id = '54000000-0000-4000-8000-000000000001';
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then raise exception 'version delete was accepted'; end if;
end;
$$;

-- Function owner, SECURITY DEFINER, fixed search_path and execute ACLs.
do $$
declare
  fn text;
  role_name text;
begin
  foreach fn in array array[
    'public.create_shipping_account_version(uuid,uuid,text,text,text,uuid,text,text,text)',
    'public.record_shipping_account_version_check(uuid,text)',
    'public.set_shipping_account_version_enabled(uuid,boolean)',
    'public.revoke_shipping_account_version(uuid)',
    'public.bind_shipping_account_version_to_store(uuid,uuid,text)'
  ] loop
    if not has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception 'service_role lacks execute on %', fn;
    end if;
    if has_function_privilege('anon', fn, 'EXECUTE')
       or has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'client role can execute restricted RPC %', fn;
    end if;
    if (select p.prosecdef is not true
          or pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres'
          or not (coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']::text[])
        from pg_catalog.pg_proc p where p.oid = fn::regprocedure) then
      raise exception 'RPC security definer owner/search_path mismatch: %', fn;
    end if;
  end loop;

  if has_function_privilege('service_role', 'public.guard_shipping_account_version_insert()', 'EXECUTE')
     or has_function_privilege('anon', 'public.guard_shipping_account_version_insert()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_shipping_account_version_insert()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.guard_shipping_account_version_update()', 'EXECUTE')
     or has_function_privilege('anon', 'public.guard_shipping_account_version_update()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_shipping_account_version_update()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.guard_shipping_account_parent_identity_update()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.deny_shipping_account_version_delete()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.deny_shipping_account_version_binding_mutation()', 'EXECUTE') then
    raise exception 'trigger function is exposed as an RPC';
  end if;

  foreach role_name in array array['anon', 'authenticated'] loop
    if has_table_privilege(role_name, 'public.shipping_provider_account_versions', 'SELECT')
       or has_table_privilege(role_name, 'public.shipping_provider_account_versions', 'INSERT')
       or has_table_privilege(role_name, 'public.shipping_provider_account_versions', 'UPDATE')
       or has_table_privilege(role_name, 'public.shipping_provider_account_versions', 'DELETE')
       or has_table_privilege(role_name, 'public.shipping_account_version_store_bindings', 'SELECT')
       or has_table_privilege(role_name, 'public.shipping_account_version_store_bindings', 'INSERT')
       or has_table_privilege(role_name, 'public.shipping_account_version_store_bindings', 'UPDATE')
       or has_table_privilege(role_name, 'public.shipping_account_version_store_bindings', 'DELETE') then
      raise exception '% has direct version table privileges', role_name;
    end if;
  end loop;

  if position('for share' in lower(pg_catalog.pg_get_functiondef(
       'public.guard_shipping_account_version_insert()'::regprocedure))) = 0 then
    raise exception 'version insert trigger does not lock the account parent FOR SHARE';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) acl
    where p.oid = any(array[
      'public.create_shipping_account_version(uuid,uuid,text,text,text,uuid,text,text,text)'::regprocedure,
      'public.record_shipping_account_version_check(uuid,text)'::regprocedure,
      'public.set_shipping_account_version_enabled(uuid,boolean)'::regprocedure,
      'public.revoke_shipping_account_version(uuid)'::regprocedure,
      'public.bind_shipping_account_version_to_store(uuid,uuid,text)'::regprocedure
    ])
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC has EXECUTE on a lifecycle RPC';
  end if;

  if not (select c.relrowsecurity from pg_catalog.pg_class c
          where c.oid = 'public.shipping_provider_account_versions'::regclass)
     or not (select c.relrowsecurity from pg_catalog.pg_class c
             where c.oid = 'public.shipping_account_version_store_bindings'::regclass) then
    raise exception 'RLS is not enabled';
  end if;
end;
$$;

rollback;
