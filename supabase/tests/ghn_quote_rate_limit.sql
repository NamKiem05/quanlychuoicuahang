-- Run only on a disposable Supabase test project after migrations 004 and 005.
-- This is a real PostgreSQL integration check; all bucket fixtures roll back.
begin;

do $$
declare
  ip_blocked text := repeat('a', 64);
  ip_store_blocked text := repeat('b', 64);
  ip_valid text := repeat('c', 64);
  ip_retry text := repeat('d', 64);
  ip_threshold text := repeat('1', 64);
  store_ip_threshold uuid := '51000000-0000-4000-8000-000000000007';
  ip_store_threshold text;
  store_threshold uuid := '51000000-0000-4000-8000-000000000008';
  store_ip_blocked uuid := '51000000-0000-4000-8000-000000000001';
  store_ip_target uuid := '51000000-0000-4000-8000-000000000002';
  store_full uuid := '51000000-0000-4000-8000-000000000003';
  store_valid uuid := '51000000-0000-4000-8000-000000000004';
  store_retry uuid := '51000000-0000-4000-8000-000000000005';
  current_window timestamptz := date_trunc('minute', clock_timestamp());
  result record;
  count_value bigint;
  object_owner name;
  cron_user name;
  is_security_definer boolean;
begin
  -- Keep threshold assertions inside one fresh minute even if the script is
  -- started near a fixed-window boundary.
  perform pg_catalog.pg_sleep(greatest(0, 60 - extract(epoch from (clock_timestamp() - current_window)) + 0.2)::double precision);
  current_window := date_trunc('minute', clock_timestamp());

  -- A full IP must not consume a store's last slot.
  insert into public.ghn_quote_rate_limit_buckets values
    ('ip', ip_blocked, current_window, 60),
    ('store', store_ip_target::text, current_window, 299);
  select * into result from public.consume_ghn_quote_rate_limit(ip_blocked, store_ip_target);
  if result.allowed or result.retry_after not between 1 and 60 then raise exception 'IP threshold/retry failed'; end if;
  select hit_count into count_value from public.ghn_quote_rate_limit_buckets
   where bucket_type = 'store' and bucket_key = store_ip_target::text and window_started_at = current_window;
  if count_value <> 299 then raise exception 'blocked IP incremented store counter'; end if;

  -- A full store must not consume an IP's last slot.
  insert into public.ghn_quote_rate_limit_buckets values
    ('ip', ip_store_blocked, current_window, 59),
    ('store', store_full::text, current_window, 300);
  select * into result from public.consume_ghn_quote_rate_limit(ip_store_blocked, store_full);
  if result.allowed or result.retry_after not between 1 and 60 then raise exception 'store threshold/retry failed'; end if;
  select hit_count into count_value from public.ghn_quote_rate_limit_buckets
   where bucket_type = 'ip' and bucket_key = ip_store_blocked and window_started_at = current_window;
  if count_value <> 59 then raise exception 'blocked store incremented IP counter'; end if;

  -- A valid call increments both counters exactly once.
  select * into result from public.consume_ghn_quote_rate_limit(ip_valid, store_valid);
  if not result.allowed then raise exception 'valid request was denied'; end if;
  select hit_count into count_value from public.ghn_quote_rate_limit_buckets
   where bucket_type = 'ip' and bucket_key = ip_valid and window_started_at = current_window;
  if count_value <> 1 then raise exception 'valid request did not increment IP exactly once'; end if;
  select hit_count into count_value from public.ghn_quote_rate_limit_buckets
   where bucket_type = 'store' and bucket_key = store_valid::text and window_started_at = current_window;
  if count_value <> 1 then raise exception 'valid request did not increment store exactly once'; end if;

  -- Exercise the exact 60/IP and 300/store boundaries in PostgreSQL.
  for i in 1..60 loop
    select * into result from public.consume_ghn_quote_rate_limit(ip_threshold, pg_catalog.gen_random_uuid());
    if not result.allowed then raise exception 'IP request % was denied before threshold 60', i; end if;
  end loop;
  select * into result from public.consume_ghn_quote_rate_limit(ip_threshold, store_ip_threshold);
  if result.allowed then raise exception 'IP request 61 was allowed'; end if;
  select hit_count into count_value from public.ghn_quote_rate_limit_buckets
   where bucket_type = 'ip' and bucket_key = ip_threshold and window_started_at = current_window;
  if count_value <> 60 then raise exception 'IP counter did not stop at exactly 60'; end if;

  for i in 1..300 loop
    ip_store_threshold := pg_catalog.lpad(i::text, 64, '0');
    select * into result from public.consume_ghn_quote_rate_limit(ip_store_threshold, store_threshold);
    if not result.allowed then raise exception 'store request % was denied before threshold 300', i; end if;
  end loop;
  select * into result from public.consume_ghn_quote_rate_limit(pg_catalog.lpad('301', 64, '0'), store_threshold);
  if result.allowed then raise exception 'store request 301 was allowed'; end if;
  select hit_count into count_value from public.ghn_quote_rate_limit_buckets
   where bucket_type = 'store' and bucket_key = store_threshold::text and window_started_at = current_window;
  if count_value <> 300 then raise exception 'store counter did not stop at exactly 300'; end if;

  -- Align just after a minute boundary to verify Retry-After near the start.
  perform pg_catalog.pg_sleep(greatest(0, 60 - extract(epoch from (clock_timestamp() - current_window)) + 0.2)::double precision);
  current_window := date_trunc('minute', clock_timestamp());
  insert into public.ghn_quote_rate_limit_buckets values ('ip', ip_retry, current_window, 60);
  select * into result from public.consume_ghn_quote_rate_limit(ip_retry, store_retry);
  if result.allowed or result.retry_after not between 58 and 60 then raise exception 'start-window retry outside expected range'; end if;

  -- Retest near the boundary using a full bucket in the active minute.
  perform pg_catalog.pg_sleep(greatest(0, 57 - extract(epoch from (clock_timestamp() - current_window)))::double precision);
  current_window := date_trunc('minute', clock_timestamp());
  insert into public.ghn_quote_rate_limit_buckets values ('ip', repeat('e', 64), current_window, 60);
  select * into result from public.consume_ghn_quote_rate_limit(repeat('e', 64), store_retry);
  if result.allowed or result.retry_after not between 1 and 4 then raise exception 'end-window retry did not reflect remaining seconds'; end if;

  -- Cleanup removes old windows only and preserves all active-window buckets.
  insert into public.ghn_quote_rate_limit_buckets values
    ('ip', repeat('f', 64), clock_timestamp() - interval '4 minutes', 1),
    ('store', '51000000-0000-4000-8000-000000000006', date_trunc('minute', clock_timestamp()), 1);
  perform public.cleanup_ghn_quote_rate_limits();
  if exists (select 1 from public.ghn_quote_rate_limit_buckets where bucket_key = repeat('f', 64)) then
    raise exception 'cleanup kept an old bucket';
  end if;
  if not exists (select 1 from public.ghn_quote_rate_limit_buckets where bucket_key = '51000000-0000-4000-8000-000000000006') then
    raise exception 'cleanup deleted an active window';
  end if;

  -- RPC is service-role-only; no direct table privilege is granted to API roles.
  if has_function_privilege('anon', 'public.consume_ghn_quote_rate_limit(text,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.consume_ghn_quote_rate_limit(text,uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.consume_ghn_quote_rate_limit(text,uuid)', 'EXECUTE') then
    raise exception 'consume RPC EXECUTE grants are incorrect';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc p,
      lateral pg_catalog.aclexplode(p.proacl) acl
    where p.oid = 'public.consume_ghn_quote_rate_limit(text,uuid)'::regprocedure
      and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ) or exists (
    select 1 from pg_catalog.pg_proc p,
      lateral pg_catalog.aclexplode(p.proacl) acl
    where p.oid = 'public.cleanup_ghn_quote_rate_limits()'::regprocedure
      and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC can execute a rate-limit function';
  end if;
  if has_table_privilege('anon', 'public.ghn_quote_rate_limit_buckets', 'SELECT')
     or has_table_privilege('anon', 'public.ghn_quote_rate_limit_buckets', 'INSERT')
     or has_table_privilege('anon', 'public.ghn_quote_rate_limit_buckets', 'UPDATE')
     or has_table_privilege('anon', 'public.ghn_quote_rate_limit_buckets', 'DELETE')
     or has_table_privilege('authenticated', 'public.ghn_quote_rate_limit_buckets', 'SELECT')
     or has_table_privilege('authenticated', 'public.ghn_quote_rate_limit_buckets', 'INSERT')
     or has_table_privilege('authenticated', 'public.ghn_quote_rate_limit_buckets', 'UPDATE')
     or has_table_privilege('authenticated', 'public.ghn_quote_rate_limit_buckets', 'DELETE')
     or has_table_privilege('service_role', 'public.ghn_quote_rate_limit_buckets', 'SELECT')
     or has_table_privilege('service_role', 'public.ghn_quote_rate_limit_buckets', 'INSERT')
     or has_table_privilege('service_role', 'public.ghn_quote_rate_limit_buckets', 'UPDATE')
     or has_table_privilege('service_role', 'public.ghn_quote_rate_limit_buckets', 'DELETE') then
    raise exception 'direct table access is too broad';
  end if;
  if exists (
    select 1 from pg_catalog.pg_class c,
      lateral pg_catalog.aclexplode(c.relacl) acl
    where c.oid = 'public.ghn_quote_rate_limit_buckets'::regclass
      and acl.grantee = 0
      and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'PUBLIC has direct table privileges';
  end if;
  if (select count(*) from cron.job where jobname = 'growdesk-clean-ghn-quote-rate-limits') <> 1 then
    raise exception 'expected exactly one cleanup cron job';
  end if;

  select pg_catalog.pg_get_userbyid(c.relowner) into object_owner
  from pg_catalog.pg_class c
  where c.oid = 'public.ghn_quote_rate_limit_buckets'::regclass;
  if object_owner <> 'postgres' then raise exception 'rate-limit table owner is not postgres'; end if;

  select pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef into object_owner, is_security_definer
  from pg_catalog.pg_proc p
  where p.oid = 'public.consume_ghn_quote_rate_limit(text,uuid)'::regprocedure;
  if object_owner <> 'postgres' or is_security_definer is not true then
    raise exception 'consume function owner/security mode is incorrect';
  end if;
  if not has_table_privilege(object_owner, 'public.ghn_quote_rate_limit_buckets', 'SELECT')
     or not has_table_privilege(object_owner, 'public.ghn_quote_rate_limit_buckets', 'INSERT')
     or not has_table_privilege(object_owner, 'public.ghn_quote_rate_limit_buckets', 'UPDATE')
     or not has_table_privilege(object_owner, 'public.ghn_quote_rate_limit_buckets', 'DELETE') then
    raise exception 'consume function owner lacks table privileges';
  end if;

  select pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef into object_owner, is_security_definer
  from pg_catalog.pg_proc p
  where p.oid = 'public.cleanup_ghn_quote_rate_limits()'::regprocedure;
  if object_owner <> 'postgres' or is_security_definer is not true then
    raise exception 'cleanup function owner/security mode is incorrect';
  end if;
  if not has_table_privilege(object_owner, 'public.ghn_quote_rate_limit_buckets', 'SELECT')
     or not has_table_privilege(object_owner, 'public.ghn_quote_rate_limit_buckets', 'DELETE') then
    raise exception 'cleanup function owner lacks table privileges';
  end if;

  select username into cron_user from cron.job where jobname = 'growdesk-clean-ghn-quote-rate-limits';
  if cron_user <> object_owner then raise exception 'cron role does not match cleanup function owner'; end if;
  if not has_function_privilege(cron_user, 'public.cleanup_ghn_quote_rate_limits()', 'EXECUTE') then
    raise exception 'cron role cannot execute cleanup function';
  end if;
  if has_function_privilege('service_role', 'public.cleanup_ghn_quote_rate_limits()', 'EXECUTE')
     or has_function_privilege('anon', 'public.cleanup_ghn_quote_rate_limits()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cleanup_ghn_quote_rate_limits()', 'EXECUTE') then
    raise exception 'cleanup function is executable by API roles';
  end if;
end;
$$;

rollback;
