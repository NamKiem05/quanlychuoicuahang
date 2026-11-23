-- Run after 202611230003 as a database administrator on a test database.
-- has_*_privilege checks effective privileges, including inherited grants.
begin;

do $$
declare
  relation regclass;
  role_name text;
  privilege_name text;
begin
  foreach relation in array array[
    'public.shipping_providers'::regclass,
    'public.shipping_provider_accounts'::regclass,
    'public.shipping_account_checks'::regclass
  ] loop
    foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE'] loop
      if not has_table_privilege('service_role', relation, privilege_name) then
        raise exception 'service_role lacks % on %', privilege_name, relation;
      end if;
    end loop;

    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      foreach privilege_name in array array['DELETE', 'TRUNCATE', 'TRIGGER'] loop
        if has_table_privilege(role_name, relation, privilege_name) then
          raise exception '% still has % on %; inspect direct and inherited ACLs',
            role_name, privilege_name, relation;
        end if;
      end loop;
      if has_any_column_privilege(role_name, relation, 'REFERENCES') then
        raise exception '% still has REFERENCES on %; inspect table and column ACLs', role_name, relation;
      end if;
    end loop;

    foreach role_name in array array['anon', 'authenticated'] loop
      if has_any_column_privilege(role_name, relation, 'INSERT')
        or has_any_column_privilege(role_name, relation, 'UPDATE') then
        raise exception '% gained write access to %', role_name, relation;
      end if;
    end loop;
  end loop;

  if not has_function_privilege('service_role', 'public.begin_shipping_account_check(uuid,uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.finish_shipping_account_check(uuid,uuid,text,text)', 'EXECUTE') then
    raise exception 'service_role lost access to a shipping RPC';
  end if;

  foreach role_name in array array['anon', 'authenticated'] loop
    if has_function_privilege(role_name, 'public.begin_shipping_account_check(uuid,uuid)', 'EXECUTE')
      or has_function_privilege(role_name, 'public.finish_shipping_account_check(uuid,uuid,text,text)', 'EXECUTE')
      or has_function_privilege(role_name, 'public.expire_shipping_account_checks()', 'EXECUTE') then
      raise exception '% gained execute access to a shipping RPC', role_name;
    end if;
  end loop;
end;
$$;

set local role service_role;
do $$
declare
  relation regclass;
begin
  foreach relation in array array[
    'public.shipping_providers'::regclass,
    'public.shipping_provider_accounts'::regclass,
    'public.shipping_account_checks'::regclass
  ] loop
    begin
      execute format('delete from %s where false', relation);
      raise exception 'DELETE succeeded on %', relation;
    exception when insufficient_privilege then null;
    end;
    begin
      execute format('truncate %s', relation);
      raise exception 'TRUNCATE succeeded on %', relation;
    exception when insufficient_privilege then null;
    end;
  end loop;
end;
$$;

rollback;
