-- Allow trusted server-created store staff while public registration is paused.
create or replace function public.enforce_public_signup_setting() returns trigger
language plpgsql security definer set search_path = '' as $$
declare signup_allowed boolean;
begin
  if new.raw_app_meta_data ->> 'created_by_platform_admin' = 'true'
    or new.raw_app_meta_data ->> 'account_kind' = 'platform_admin'
    or new.raw_app_meta_data ->> 'created_by_store_owner' = 'true' then return new; end if;
  select public_signup_enabled into signup_allowed from public.platform_operations_settings where id = true for share;
  if signup_allowed is distinct from true then raise exception 'public_registration_disabled' using errcode = 'P0001'; end if;
  return new;
end;
$$;

create function public.owner_can_create_staff(target_store uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_store_role(target_store, array['owner']::public.store_member_role[]);
$$;

create function public.owner_attach_created_staff(target_store uuid, target_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare new_user auth.users%rowtype;
begin
  if not public.has_store_role(target_store, array['owner']::public.store_member_role[]) then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into new_user from auth.users where id = target_user for update;
  if not found or new_user.email_confirmed_at is not null or new_user.created_at < now() - interval '15 minutes'
    or new_user.raw_app_meta_data->>'created_by_store_owner' is distinct from 'true'
    or new_user.raw_app_meta_data->>'staff_store_id' is distinct from target_store::text
    or new_user.raw_app_meta_data->>'staff_creator_id' is distinct from auth.uid()::text
    or public.is_dedicated_platform_account(target_user)
    or exists(select 1 from public.store_members where user_id = target_user) then
    raise exception 'invalid newly created staff account' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_store::text, 173));
  insert into public.store_members(store_id, user_id, role) values(target_store, target_user, 'staff');
end;
$$;
revoke all on function public.owner_can_create_staff(uuid), public.owner_attach_created_staff(uuid,uuid) from public, anon, authenticated;
grant execute on function public.owner_can_create_staff(uuid), public.owner_attach_created_staff(uuid,uuid) to authenticated;
