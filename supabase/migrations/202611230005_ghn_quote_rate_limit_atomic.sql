begin;

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'apply this migration as postgres so function ownership and the cleanup job are consistent';
  end if;

  if pg_catalog.to_regclass('public.ghn_quote_rate_limit_buckets') is null
     or pg_catalog.to_regprocedure('public.consume_ghn_quote_rate_limit(text,uuid)') is null
     or pg_catalog.to_regprocedure('public.cleanup_ghn_quote_rate_limits()') is null then
    raise exception 'migration 202611230005 requires migration 202611230004 to be fully applied';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class c
    where c.oid = pg_catalog.to_regclass('public.ghn_quote_rate_limit_buckets')
      and c.relkind = 'r'
  ) or not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = pg_catalog.to_regclass('public.ghn_quote_rate_limit_buckets')
      and a.attname = 'bucket_type' and a.atttypid = 'pg_catalog.text'::pg_catalog.regtype
      and a.attnum > 0 and not a.attisdropped
  ) or not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = pg_catalog.to_regclass('public.ghn_quote_rate_limit_buckets')
      and a.attname = 'bucket_key' and a.atttypid = 'pg_catalog.text'::pg_catalog.regtype
      and a.attnum > 0 and not a.attisdropped
  ) or not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = pg_catalog.to_regclass('public.ghn_quote_rate_limit_buckets')
      and a.attname = 'window_started_at' and a.atttypid = 'pg_catalog.timestamptz'::pg_catalog.regtype
      and a.attnum > 0 and not a.attisdropped
  ) or not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = pg_catalog.to_regclass('public.ghn_quote_rate_limit_buckets')
      and a.attname = 'hit_count' and a.atttypid = 'pg_catalog.int8'::pg_catalog.regtype
      and a.attnum > 0 and not a.attisdropped
  ) or not exists (
    select 1 from pg_catalog.pg_constraint k
    where k.conrelid = pg_catalog.to_regclass('public.ghn_quote_rate_limit_buckets')
      and k.contype = 'p'
      and pg_catalog.array_length(k.conkey, 1) = 3
      and k.conkey[1] = (select a.attnum from pg_catalog.pg_attribute a where a.attrelid = k.conrelid and a.attname = 'bucket_type')
      and k.conkey[2] = (select a.attnum from pg_catalog.pg_attribute a where a.attrelid = k.conrelid and a.attname = 'bucket_key')
      and k.conkey[3] = (select a.attnum from pg_catalog.pg_attribute a where a.attrelid = k.conrelid and a.attname = 'window_started_at')
  ) then
    raise exception 'migration 202611230004 rate-limit table is incomplete or has an incompatible schema';
  end if;
end;
$$;

-- The route only calls the SECURITY DEFINER RPC. Do not expose bucket rows directly,
-- including to service_role; cleanup and counter writes happen under function ownership.
-- CREATE OR REPLACE preserves existing owners. Pin ownership explicitly so the
-- definer can still mutate the table after service_role's ACL is revoked.
alter table public.ghn_quote_rate_limit_buckets owner to postgres;
revoke all on public.ghn_quote_rate_limit_buckets from public, anon, authenticated, service_role;

create or replace function public.consume_ghn_quote_rate_limit(requested_ip_hash text, requested_store_id uuid)
returns table(allowed boolean, retry_after integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip_hash text;
  v_store_key text;
  v_ip_lock bigint;
  v_store_lock bigint;
  v_ip_hits bigint;
  v_store_hits bigint;
  v_now timestamptz;
  v_window timestamptz;
  v_retry integer;
begin
  if requested_ip_hash is null
     or pg_catalog.char_length(requested_ip_hash) <> 64
     or requested_ip_hash !~* '^[0-9a-f]{64}$'
     or requested_store_id is null then
    raise exception 'invalid GHN rate limit key' using errcode = '22023';
  end if;

  -- Canonicalize hex so uppercase input cannot create a second bucket for the same HMAC.
  v_ip_hash := pg_catalog.lower(requested_ip_hash);
  v_store_key := requested_store_id::text;

  -- All callers acquire the same two transaction locks in ascending order.
  -- Hash collisions only serialize unrelated requests; they cannot bypass a quota.
  v_ip_lock := pg_catalog.hashtextextended('growdesk:ghn-quote:ip:' || v_ip_hash, 772024);
  v_store_lock := pg_catalog.hashtextextended('growdesk:ghn-quote:store:' || v_store_key, 772024);
  if v_ip_lock < v_store_lock then
    perform pg_catalog.pg_advisory_xact_lock(v_ip_lock);
    perform pg_catalog.pg_advisory_xact_lock(v_store_lock);
  elsif v_store_lock < v_ip_lock then
    perform pg_catalog.pg_advisory_xact_lock(v_store_lock);
    perform pg_catalog.pg_advisory_xact_lock(v_ip_lock);
  else
    perform pg_catalog.pg_advisory_xact_lock(v_ip_lock);
  end if;

  -- Determine the fixed window after acquiring locks, so lock wait time cannot
  -- make a request consume a stale minute's quota.
  v_now := pg_catalog.clock_timestamp();
  v_window := pg_catalog.date_trunc('minute', v_now);

  select coalesce((
    select b.hit_count from public.ghn_quote_rate_limit_buckets b
    where b.bucket_type = 'ip' and b.bucket_key = v_ip_hash and b.window_started_at = v_window
  ), 0) into v_ip_hits;

  if v_ip_hits >= 60 then
    v_retry := greatest(1, least(60, pg_catalog.ceil(extract(epoch from (v_window + interval '1 minute' - pg_catalog.clock_timestamp())))::integer));
    return query select false, v_retry;
    return;
  end if;

  select coalesce((
    select b.hit_count from public.ghn_quote_rate_limit_buckets b
    where b.bucket_type = 'store' and b.bucket_key = v_store_key and b.window_started_at = v_window
  ), 0) into v_store_hits;

  if v_store_hits >= 300 then
    v_retry := greatest(1, least(60, pg_catalog.ceil(extract(epoch from (v_window + interval '1 minute' - pg_catalog.clock_timestamp())))::integer));
    return query select false, v_retry;
    return;
  end if;

  -- Both increments are one SQL statement in this transaction. The locks make
  -- the preceding pair of quota checks serializable for the affected keys.
  insert into public.ghn_quote_rate_limit_buckets (bucket_type, bucket_key, window_started_at, hit_count)
  values ('ip', v_ip_hash, v_window, 1), ('store', v_store_key, v_window, 1)
  on conflict (bucket_type, bucket_key, window_started_at) do update
    set hit_count = public.ghn_quote_rate_limit_buckets.hit_count + 1;

  v_retry := greatest(1, least(60, pg_catalog.ceil(extract(epoch from (v_window + interval '1 minute' - pg_catalog.clock_timestamp())))::integer));
  return query select true, v_retry;
end;
$$;

alter function public.consume_ghn_quote_rate_limit(text, uuid) owner to postgres;
revoke all on function public.consume_ghn_quote_rate_limit(text, uuid) from public, anon, authenticated;
grant execute on function public.consume_ghn_quote_rate_limit(text, uuid) to service_role;

create or replace function public.cleanup_ghn_quote_rate_limits()
returns bigint
language sql
security definer
set search_path = ''
as $$
  with deleted as (
    delete from public.ghn_quote_rate_limit_buckets
     where window_started_at < pg_catalog.clock_timestamp() - interval '3 minutes'
    returning 1
  )
  select pg_catalog.count(*)::bigint from deleted;
$$;

alter function public.cleanup_ghn_quote_rate_limits() owner to postgres;
revoke all on function public.cleanup_ghn_quote_rate_limits() from public, anon, authenticated, service_role;

-- pg_cron was enabled by 202611230002. Verify the extension and required objects,
-- then remove stale jobs of this name before installing exactly one schedule.
do $$
declare
  existing_job bigint;
begin
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron')
     or pg_catalog.to_regclass('cron.job') is null
     or pg_catalog.to_regprocedure('cron.schedule(text,text,text)') is null
     or pg_catalog.to_regprocedure('cron.unschedule(bigint)') is null then
    raise exception 'pg_cron must be installed before scheduling GHN quote cleanup';
  end if;

  for existing_job in
    select jobid from cron.job where jobname = 'growdesk-clean-ghn-quote-rate-limits'
  loop
    perform cron.unschedule(existing_job);
  end loop;

  perform cron.schedule(
    'growdesk-clean-ghn-quote-rate-limits',
    '*/10 * * * *',
    'select public.cleanup_ghn_quote_rate_limits()'
  );

  if not exists (
    select 1 from cron.job
    where jobname = 'growdesk-clean-ghn-quote-rate-limits'
      and username = 'postgres'
  ) then
    raise exception 'GHN cleanup cron job must execute as postgres';
  end if;
end;
$$;

commit;
