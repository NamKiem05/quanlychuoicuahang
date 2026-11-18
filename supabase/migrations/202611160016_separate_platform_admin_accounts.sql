update auth.users u
set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || '{"account_kind":"platform_admin"}'::jsonb
where exists (select 1 from public.platform_admins a where a.user_id = u.id);

create function public.is_dedicated_platform_account(target_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u
    where u.id = target_user and u.raw_app_meta_data ->> 'account_kind' = 'platform_admin'
  );
$$;

create function public.platform_account_access()
returns text language sql stable security definer set search_path = '' as $$
  select case
    when public.is_platform_admin() then 'admin'
    when public.is_dedicated_platform_account(auth.uid()) then 'admin_inactive'
    else 'merchant'
  end;
$$;

create function public.guard_platform_admin_grant()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_dedicated_platform_account(new.user_id)
    or exists (select 1 from public.store_members m where m.user_id = new.user_id)
    or exists (select 1 from public.stores s where s.created_by = new.user_id or s.billing_owner_id = new.user_id)
    or exists (select 1 from public.merchant_plan_payments p where p.user_id = new.user_id) then
    raise exception 'dedicated_admin_account_required';
  end if;
  return new;
end;
$$;

create function public.guard_merchant_account()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  target_user uuid;
begin
  if tg_table_name = 'stores' then
    if tg_op = 'INSERT' or new.created_by is distinct from old.created_by then
      target_user := new.created_by;
    end if;
    if tg_op = 'INSERT' or new.billing_owner_id is distinct from old.billing_owner_id then
      if public.is_dedicated_platform_account(new.billing_owner_id) then
        raise exception 'merchant_account_required';
      end if;
    end if;
  else
    if tg_op = 'INSERT' or new.user_id is distinct from old.user_id then
      target_user := new.user_id;
    end if;
  end if;
  if public.is_dedicated_platform_account(target_user) then
    raise exception 'merchant_account_required';
  end if;
  return new;
end;
$$;

create trigger platform_admin_account_only
  before insert or update of user_id on public.platform_admins
  for each row execute function public.guard_platform_admin_grant();
create trigger merchant_store_account_only
  before insert or update of created_by, billing_owner_id on public.stores
  for each row execute function public.guard_merchant_account();
create trigger merchant_member_account_only
  before insert or update of user_id on public.store_members
  for each row execute function public.guard_merchant_account();
create trigger merchant_payment_account_only
  before insert or update of user_id on public.merchant_plan_payments
  for each row execute function public.guard_merchant_account();

create or replace function public.has_store_role(
  requested_store_id uuid,
  allowed_roles public.store_member_role[] default array['owner', 'staff']::public.store_member_role[]
)
returns boolean language sql stable security definer set search_path = '' as $$
  select not public.is_dedicated_platform_account(auth.uid()) and exists (
    select 1 from public.store_members
    where store_id = requested_store_id and user_id = (select auth.uid()) and role = any (allowed_roles)
  );
$$;

revoke all on function public.is_dedicated_platform_account(uuid), public.platform_account_access(),
  public.guard_platform_admin_grant(), public.guard_merchant_account() from public, anon, authenticated;
grant execute on function public.platform_account_access() to authenticated;
