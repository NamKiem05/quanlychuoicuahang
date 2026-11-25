begin;

create table public.ghn_quote_rate_limit_buckets (
  bucket_type text not null check (bucket_type in ('ip', 'store')),
  bucket_key text not null check (char_length(bucket_key) between 1 and 80),
  window_started_at timestamptz not null,
  hit_count bigint not null check (hit_count > 0),
  primary key (bucket_type, bucket_key, window_started_at)
);

create index ghn_quote_rate_limit_window_idx
  on public.ghn_quote_rate_limit_buckets (window_started_at);

alter table public.ghn_quote_rate_limit_buckets enable row level security;
revoke all on public.ghn_quote_rate_limit_buckets from public, anon, authenticated;
grant all on public.ghn_quote_rate_limit_buckets to service_role;

create function public.consume_ghn_quote_rate_limit(requested_ip_hash text, requested_store_id uuid)
returns table(allowed boolean, retry_after integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := date_trunc('minute', statement_timestamp());
  v_ip_hits bigint;
  v_store_hits bigint;
  v_retry integer := greatest(1, ceil(extract(epoch from (v_window + interval '1 minute' - statement_timestamp())))::integer);
begin
  if requested_ip_hash !~ '^[0-9a-f]{64}$' or requested_store_id is null then
    raise exception 'invalid GHN rate limit key' using errcode = '22023';
  end if;

  with bumped as (
    insert into public.ghn_quote_rate_limit_buckets (bucket_type, bucket_key, window_started_at, hit_count)
    values ('ip', requested_ip_hash, v_window, 1), ('store', requested_store_id::text, v_window, 1)
    on conflict (bucket_type, bucket_key, window_started_at) do update
      set hit_count = least(
        public.ghn_quote_rate_limit_buckets.hit_count + 1,
        case when excluded.bucket_type = 'ip' then 61 else 301 end
      )
    returning bucket_type, hit_count
  )
  select max(hit_count) filter (where bucket_type = 'ip'),
         max(hit_count) filter (where bucket_type = 'store')
    into v_ip_hits, v_store_hits
    from bumped;

  return query select v_ip_hits <= 60 and v_store_hits <= 300, v_retry;
end;
$$;

revoke all on function public.consume_ghn_quote_rate_limit(text, uuid) from public, anon, authenticated;
grant execute on function public.consume_ghn_quote_rate_limit(text, uuid) to service_role;

create function public.cleanup_ghn_quote_rate_limits()
returns bigint
language sql
security definer
set search_path = ''
as $$
  with deleted as (
    delete from public.ghn_quote_rate_limit_buckets
     where window_started_at < statement_timestamp() - interval '3 minutes'
    returning 1
  )
  select count(*)::bigint from deleted;
$$;

revoke all on function public.cleanup_ghn_quote_rate_limits() from public, anon, authenticated;
grant execute on function public.cleanup_ghn_quote_rate_limits() to service_role;

select cron.schedule(
  'growdesk-clean-ghn-quote-rate-limits',
  '*/10 * * * *',
  'select public.cleanup_ghn_quote_rate_limits()'
);

commit;
