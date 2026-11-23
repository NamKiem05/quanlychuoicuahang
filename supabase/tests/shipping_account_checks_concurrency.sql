-- Run on a disposable local database. Set test.shipping_dblink_dsn to its
-- loopback connection string and test.shipping_check_actor/account to the UUIDs
-- of a committed Platform Admin and unused Platform Account fixture.
-- The test removes the claim it commits after the second connection is rejected.
begin;
create extension if not exists dblink with schema extensions;
set local search_path = pg_catalog, extensions, public;

do $$
declare
  dsn text := current_setting('test.shipping_dblink_dsn');
  actor uuid := current_setting('test.shipping_check_actor');
  account uuid := current_setting('test.shipping_check_account');
  command text := format('select public.begin_shipping_account_check(%L, %L)', account, actor);
  first_result jsonb;
  second_result jsonb;
  second_pid integer;
  wait_until timestamptz;
begin
  perform dblink_connect('shipping_first', dsn);
  perform dblink_connect('shipping_second', dsn);
  perform dblink_exec('shipping_first', 'begin');
  perform dblink_exec('shipping_second', 'begin');
  perform dblink_exec('shipping_first', 'set local role service_role');
  perform dblink_exec('shipping_second', 'set local role service_role');
  select pid into second_pid from dblink('shipping_second', 'select pg_backend_pid()') as result(pid integer);

  select result.claim into first_result from dblink('shipping_first', command) as result(claim jsonb);
  if first_result->>'state' is distinct from 'claimed' then
    raise exception 'first session could not claim its fixture';
  end if;
  perform dblink_send_query('shipping_second', command);
  wait_until := clock_timestamp() + interval '5 seconds';
  while cardinality(pg_blocking_pids(second_pid)) = 0 loop
    if dblink_is_busy('shipping_second') = 0 or clock_timestamp() >= wait_until then
      raise exception 'second session did not wait on the account lock';
    end if;
    perform pg_sleep(0.02);
  end loop;

  perform dblink_exec('shipping_first', 'commit');
  select result.claim into second_result from dblink_get_result('shipping_second') as result(claim jsonb);
  perform result.claim from dblink_get_result('shipping_second') as result(claim jsonb);
  if second_result->>'state' is distinct from 'busy' then
    raise exception 'both sessions acquired the same account';
  end if;
  perform dblink_exec('shipping_second', 'rollback');
  -- Remove only the check created by this test for the supplied fixture.
  perform dblink_exec('shipping_first', format(
    'delete from public.shipping_account_checks where id = %L and account_id = %L',
    first_result->>'id', account
  ));
  perform dblink_disconnect('shipping_first');
  perform dblink_disconnect('shipping_second');
end;
$$;

rollback;
