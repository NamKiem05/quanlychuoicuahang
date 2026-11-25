begin;

create table public.growdesk_session_activity (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  last_activity_at timestamptz not null
);
alter table public.growdesk_session_activity enable row level security;
revoke all on public.growdesk_session_activity from public, anon, authenticated, service_role;

create function public.growdesk_session_status(record_activity boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  session_key text := auth.jwt()->>'session_id';
  actor uuid := auth.uid();
  started_at timestamptz;
  auth_deadline timestamptz;
  last_active timestamptz;
  checked_at timestamptz;
  deadline timestamptz;
  idle_limit interval;
begin
  if actor is null or session_key is null or session_key !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
    return jsonb_build_object('status', 'expired');
  end if;

  if record_activity then
    -- Serialize activity from different tabs and do not resurrect a revoked session.
    perform 1 from auth.sessions s where s.id = session_key::uuid and s.user_id = actor for no key update;
    if not found then return jsonb_build_object('status', 'expired'); end if;
  end if;

  select s.created_at, s.not_after, coalesce(a.last_activity_at, s.created_at)
  into started_at, auth_deadline, last_active
  from auth.sessions s
  join auth.users u on u.id = s.user_id
  left join public.growdesk_session_activity a on a.session_id = s.id
  where s.id = session_key::uuid and s.user_id = actor
    and (u.banned_until is null or u.banned_until <= clock_timestamp());
  if not found then return jsonb_build_object('status', 'expired'); end if;

  checked_at := clock_timestamp();
  if auth_deadline <= checked_at then return jsonb_build_object('status', 'expired'); end if;

  if public.platform_account_access() in ('admin', 'admin_inactive') or public.has_support_ticket_permission() then
    idle_limit := interval '15 minutes';
  elsif exists (select 1 from public.store_members m where m.user_id = actor and m.role in ('owner', 'staff')) then
    idle_limit := interval '30 minutes';
  else
    return jsonb_build_object('status', 'active');
  end if;

  deadline := least(last_active + idle_limit, started_at + interval '12 hours', auth_deadline);
  if deadline <= checked_at then return jsonb_build_object('status', 'expired'); end if;

  if record_activity then
    insert into public.growdesk_session_activity (session_id, last_activity_at)
    values (session_key::uuid, checked_at)
    on conflict (session_id) do update set last_activity_at = excluded.last_activity_at;
    deadline := least(checked_at + idle_limit, started_at + interval '12 hours', auth_deadline);
  end if;
  return jsonb_build_object('status', 'active', 'remainingMs', floor(extract(epoch from (deadline - checked_at)) * 1000));
end;
$$;

create function public.growdesk_session_is_active()
returns boolean language sql security invoker set search_path = '' as $$
  select public.growdesk_session_status(false)->>'status' = 'active';
$$;

create function public.growdesk_postgrest_session_guard()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if current_user = 'authenticated' and public.growdesk_session_is_active() is not true then
    raise exception 'GrowDesk session expired' using errcode = 'PT401';
  end if;
end;
$$;

alter function public.growdesk_session_status(boolean) owner to postgres;
revoke all on function public.growdesk_session_status(boolean), public.growdesk_session_is_active(),
  public.growdesk_postgrest_session_guard() from public, anon, authenticated, service_role;
grant execute on function public.growdesk_session_status(boolean), public.growdesk_session_is_active() to authenticated;
grant execute on function public.growdesk_postgrest_session_guard() to anon, authenticated, service_role;

-- PostgREST covers direct table and RPC requests, including SECURITY DEFINER RPCs.
-- Keep an existing hook intact and fail the migration if one must be composed.
do $$
begin
  if exists (select 1 from pg_db_role_setting r cross join lateral unnest(r.setconfig) c(setting)
    where r.setrole in (0, 'authenticator'::regrole::oid) and c.setting like 'pgrst.db_pre_request=%') then
    raise exception 'An existing PostgREST pre-request hook must be composed before applying session controls';
  end if;
  execute format('alter role authenticator in database %I set pgrst.db_pre_request = %L',
    current_database(), 'public.growdesk_postgrest_session_guard');
end;
$$;

-- Storage and Postgres Changes can evaluate RLS outside PostgREST.
create policy growdesk_require_live_session on public.orders as restrictive for all to authenticated
  using ((select public.growdesk_session_is_active())) with check ((select public.growdesk_session_is_active()));
create policy growdesk_require_live_session on public.store_admin_messages as restrictive for all to authenticated
  using ((select public.growdesk_session_is_active())) with check ((select public.growdesk_session_is_active()));
create policy growdesk_require_live_session on storage.objects as restrictive for all to authenticated
  using ((select public.growdesk_session_is_active())) with check ((select public.growdesk_session_is_active()));

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
commit;
