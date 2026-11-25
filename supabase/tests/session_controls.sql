-- Local only. Every fixture and simulated time change is rolled back.
begin;

insert into auth.users (id, email, raw_app_meta_data) values
  ('71000000-0000-4000-8000-000000000001', 'session-owner@example.invalid', '{}'),
  ('71000000-0000-4000-8000-000000000002', 'session-admin@example.invalid', '{"account_kind":"platform_admin"}');
insert into public.stores (id, created_by, name, slug) values
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'Session test', 'session-control-test');
insert into public.store_members (store_id, user_id, role) values
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'owner');
insert into public.orders (id, store_id, public_code, customer_name, customer_phone, subtotal_vnd, total_vnd) values
  ('74000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001',
    'SES123456789', 'Session test customer', '0900000000', 10000, 10000);
insert into auth.sessions (id, user_id, created_at, refreshed_at) values
  ('73000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', now() - interval '10 minutes', now()),
  ('73000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000001', now() - interval '31 minutes', now()),
  ('73000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000001', now() - interval '13 hours', now()),
  ('73000000-0000-4000-8000-000000000004', '71000000-0000-4000-8000-000000000002', now() - interval '16 minutes', now()),
  ('73000000-0000-4000-8000-000000000005', '71000000-0000-4000-8000-000000000001', now(), now());
insert into public.growdesk_session_activity (session_id, last_activity_at) values
  ('73000000-0000-4000-8000-000000000003', now());

set local role authenticated;
do $$
declare
  owner_id constant text := '71000000-0000-4000-8000-000000000001';
  first_device constant text := '73000000-0000-4000-8000-000000000001';
  idle_device constant text := '73000000-0000-4000-8000-000000000002';
  before_activity bigint;
  after_activity bigint;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'session_id', first_device)::text, true);
  perform public.growdesk_postgrest_session_guard();
  before_activity := (public.growdesk_session_status(false)->>'remainingMs')::bigint;
  if before_activity not between 1_100_000 and 1_200_000 then raise exception 'incorrect initial idle deadline'; end if;
  if (public.growdesk_session_status(false)->>'remainingMs')::bigint > before_activity then
    raise exception 'read extended the session';
  end if;
  after_activity := (public.growdesk_session_status(true)->>'remainingMs')::bigint;
  if after_activity is distinct from 1_800_000 then raise exception 'activity did not extend idle deadline'; end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'session_id', idle_device)::text, true);
  if public.growdesk_session_status(true)->>'status' is distinct from 'expired' then raise exception 'idle session was revived'; end if;
  begin
    perform public.growdesk_postgrest_session_guard();
    raise exception 'expired session passed PostgREST guard';
  exception when sqlstate 'PT401' then null;
  end;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'session_id', '73000000-0000-4000-8000-000000000003')::text, true);
  if public.growdesk_session_status(true)->>'status' is distinct from 'expired' then raise exception 'absolute timeout was extended'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', '71000000-0000-4000-8000-000000000002', 'session_id', '73000000-0000-4000-8000-000000000004')::text, true);
  if public.growdesk_session_status(false)->>'status' is distinct from 'expired' then raise exception 'admin idle timeout was not enforced'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', '71000000-0000-4000-8000-000000000002', 'session_id', first_device)::text, true);
  if public.growdesk_session_is_active() is distinct from false then raise exception 'session accepted for the wrong user'; end if;
end;
$$;

reset role;
delete from auth.sessions where id = '73000000-0000-4000-8000-000000000001';

set local role authenticated;
do $$
begin
  perform set_config('request.jwt.claims', '{"sub":"71000000-0000-4000-8000-000000000001","session_id":"73000000-0000-4000-8000-000000000001"}', true);
  if public.growdesk_session_is_active() is distinct from false then raise exception 'revoked JWT was accepted'; end if;
  begin
    perform public.growdesk_postgrest_session_guard();
    raise exception 'revoked session passed PostgREST guard';
  exception when sqlstate 'PT401' then null;
  end;
  perform set_config('request.jwt.claims', '{"sub":"71000000-0000-4000-8000-000000000001","session_id":"73000000-0000-4000-8000-000000000005"}', true);
  perform public.growdesk_postgrest_session_guard();
  if not exists (select 1 from public.orders where id = '74000000-0000-4000-8000-000000000001') then
    raise exception 'live session lost access to its order';
  end if;
  perform set_config('request.jwt.claims', '{"sub":"71000000-0000-4000-8000-000000000001","session_id":"73000000-0000-4000-8000-000000000001"}', true);
  if exists (select 1 from public.orders where id = '74000000-0000-4000-8000-000000000001') then
    raise exception 'direct RLS read accepted the revoked session';
  end if;
  if has_table_privilege(current_user, 'public.growdesk_session_activity', 'UPDATE')
     or has_function_privilege('anon', 'public.growdesk_session_status(boolean)', 'EXECUTE') then
    raise exception 'session privilege boundary is too broad';
  end if;
end;
$$;

reset role;
do $$
begin
  if not exists (
    select 1 from pg_proc p where p.oid = 'public.growdesk_session_status(boolean)'::regprocedure
      and p.prosecdef and p.proowner = 'postgres'::regrole and p.proconfig @> array['search_path=""']
  ) then raise exception 'unsafe session status function configuration'; end if;
  if (select count(*) from pg_policy p where p.polname = 'growdesk_require_live_session'
      and not p.polpermissive and 'authenticated'::regrole::oid = any(p.polroles)) <> 3 then
    raise exception 'restrictive Realtime or Storage policies missing';
  end if;
end;
$$;

rollback;
