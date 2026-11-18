-- Remove direct staff-account creation while retaining invitation-based membership.
drop function if exists public.owner_attach_created_staff(uuid, uuid);
drop function if exists public.owner_can_create_staff(uuid);

create or replace function public.enforce_public_signup_setting() returns trigger
language plpgsql security definer set search_path = '' as $$
declare signup_allowed boolean;
begin
  if new.raw_app_meta_data ->> 'created_by_platform_admin' = 'true'
    or new.raw_app_meta_data ->> 'account_kind' = 'platform_admin' then return new; end if;
  select public_signup_enabled into signup_allowed from public.platform_operations_settings where id = true for share;
  if signup_allowed is distinct from true then raise exception 'public_registration_disabled' using errcode = 'P0001'; end if;
  return new;
end;
$$;
