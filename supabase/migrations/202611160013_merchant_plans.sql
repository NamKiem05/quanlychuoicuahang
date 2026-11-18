create table public.merchant_plan_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  plan text not null check (plan in ('basic', 'plus')),
  amount_vnd integer not null check (
    (plan = 'basic' and amount_vnd = 49000) or (plan = 'plus' and amount_vnd = 99000)
  ),
  transfer_code text not null unique default ('GGP' || upper(left(replace(gen_random_uuid()::text, '-', ''), 16))),
  status text not null default 'pending' check (status in ('pending', 'approved')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  sepay_transaction_id text unique,
  valid_until timestamptz,
  check ((status = 'approved') = (paid_at is not null and sepay_transaction_id is not null and valid_until is not null))
);

create unique index merchant_plan_one_pending on public.merchant_plan_payments (user_id) where status = 'pending';
create index merchant_plan_user_expiry on public.merchant_plan_payments (user_id, valid_until desc) where status = 'approved';

alter table public.merchant_plan_payments enable row level security;
revoke all on public.merchant_plan_payments from public, anon, authenticated;
grant select on public.merchant_plan_payments to authenticated;
create policy merchant_plan_payments_read on public.merchant_plan_payments
  for select to authenticated using (
    user_id = (select auth.uid()) or (select public.is_platform_admin())
  );

-- Existing stores have no billing owner and retain their current permissions.
alter table public.stores add column billing_owner_id uuid unique references auth.users(id) on delete restrict;

create function public.request_merchant_plan(requested_plan text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  buyer uuid := auth.uid();
  current_plan text;
begin
  if buyer is null or requested_plan is null or requested_plan not in ('basic', 'plus') then
    raise exception 'invalid_plan';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(buyer::text, 142));

  if exists (select 1 from public.store_members m
    join public.stores s on s.id = m.store_id
    where m.user_id = buyer and s.billing_owner_id is distinct from buyer) then
    raise exception 'existing_store';
  end if;
  if exists (select 1 from public.merchant_plan_payments where user_id = buyer and status = 'pending') then
    return;
  end if;
  select plan into current_plan from public.merchant_plan_payments
    where user_id = buyer and status = 'approved' and valid_until > now()
    order by valid_until desc limit 1;
  if current_plan is not null and current_plan <> requested_plan then
    raise exception 'active_plan_exists';
  end if;
  insert into public.merchant_plan_payments (user_id, plan, amount_vnd)
    values (buyer, requested_plan, case requested_plan when 'basic' then 49000 else 99000 end);
end;
$$;

create function public.confirm_merchant_plan_transfer(
  payment_code text, received_amount integer, transaction_id text
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  payment public.merchant_plan_payments%rowtype;
  prior_expiry timestamptz;
begin
  if transaction_id is null or char_length(transaction_id) not between 1 and 120 then
    raise exception 'invalid_transaction_id';
  end if;
  select * into payment from public.merchant_plan_payments where transfer_code = payment_code for update;
  if not found then return 'unknown_code'; end if;
  if payment.status <> 'pending' then return 'already_paid'; end if;
  if received_amount is distinct from payment.amount_vnd then return 'amount_mismatch'; end if;

  select max(valid_until) into prior_expiry from public.merchant_plan_payments
    where user_id = payment.user_id and status = 'approved';
  update public.merchant_plan_payments set status = 'approved', paid_at = now(),
    sepay_transaction_id = transaction_id,
    valid_until = greatest(now(), prior_expiry) + interval '1 month'
    where id = payment.id;
  return 'activated';
exception when unique_violation then
  return 'duplicate_transaction';
end;
$$;

create function public.create_store_with_merchant_plan(
  store_name text, store_slug text, store_phone text, store_address text, store_location text
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  buyer uuid := auth.uid();
  new_store uuid;
begin
  if buyer is null then raise exception 'sign_in_required'; end if;
  if store_slug is null or char_length(store_slug) > 80 then
    raise exception 'invalid_store_slug';
  end if;
  if store_slug in ('admin', 'api', 'auth', 'chat', 'dashboard', 'demo', 'login', 'merchant-plan', 'store-host', 'track-order', 'www') then
    raise exception 'reserved_store_slug';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(buyer::text, 142));
  if not exists (select 1 from public.merchant_plan_payments
    where user_id = buyer and status = 'approved' and valid_until > now()) then
    raise exception 'active_plan_required';
  end if;
  if exists (select 1 from public.store_members where user_id = buyer) then
    raise exception 'existing_store';
  end if;
  insert into public.stores (created_by, billing_owner_id, name, slug, phone, address, location, status, accepts_orders)
    values (buyer, buyer, store_name, store_slug, store_phone, store_address, store_location::extensions.geography, 'active', false)
    returning id into new_store;
  insert into public.store_members (store_id, user_id, role) values (new_store, buyer, 'owner');
end;
$$;

drop policy stores_create_draft on public.stores;

create function public.merchant_plan_allows_orders(target_store uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.stores s where s.id = target_store
      and (s.billing_owner_id is null or exists (
        select 1 from public.merchant_plan_payments p
        where p.user_id = s.billing_owner_id and p.status = 'approved' and p.valid_until > now()
      ))
  );
$$;

create function public.enforce_merchant_order_plan()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.merchant_plan_allows_orders(new.store_id) then
    raise exception 'store_plan_expired';
  end if;
  return new;
end;
$$;
create trigger enforce_merchant_order_plan before insert on public.orders
  for each row execute function public.enforce_merchant_order_plan();

create function public.has_merchant_premium(target_store uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or exists (
    select 1 from public.stores s where s.id = target_store and public.has_store_role(s.id) and (
      s.billing_owner_id is null or (
        select p.plan = 'plus' from public.merchant_plan_payments p
        where p.user_id = s.billing_owner_id and p.status = 'approved' and p.valid_until > now()
        order by p.valid_until desc limit 1
      )
    )
  );
$$;

create policy promotions_paid_plan on public.store_promotions as restrictive
  for all to authenticated using ((select public.has_merchant_premium(store_id)))
  with check ((select public.has_merchant_premium(store_id)));

create policy custom_domains_paid_plan_insert on public.store_domains as restrictive
  for insert to authenticated with check (domain_type <> 'custom' or (select public.has_merchant_premium(store_id)));
create policy custom_domains_paid_plan_update on public.store_domains as restrictive
  for update to authenticated using (domain_type <> 'custom' or (select public.has_merchant_premium(store_id)))
  with check (domain_type <> 'custom' or (select public.has_merchant_premium(store_id)));

create function public.enforce_merchant_appearance_plan()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and new.billing_owner_id is distinct from old.billing_owner_id then
    raise exception 'billing_owner_is_read_only';
  end if;
  if current_user = 'authenticated'
    and row(new.logo_url, new.banner_url, new.theme_preset, new.storefront_layout,
      new.storefront_section_order, new.storefront_hidden_sections, new.storefront_style)
      is distinct from row(old.logo_url, old.banner_url, old.theme_preset, old.storefront_layout,
      old.storefront_section_order, old.storefront_hidden_sections, old.storefront_style)
    and not public.has_merchant_premium(old.id) then
    raise exception 'premium_plan_required';
  end if;
  return new;
end;
$$;
create trigger enforce_merchant_appearance_plan before update on public.stores
  for each row execute function public.enforce_merchant_appearance_plan();

revoke all on function public.request_merchant_plan(text),
  public.confirm_merchant_plan_transfer(text, integer, text),
  public.create_store_with_merchant_plan(text, text, text, text, text),
  public.has_merchant_premium(uuid), public.enforce_merchant_appearance_plan(),
  public.merchant_plan_allows_orders(uuid), public.enforce_merchant_order_plan()
  from public, anon, authenticated;
grant execute on function public.request_merchant_plan(text),
  public.create_store_with_merchant_plan(text, text, text, text, text),
  public.has_merchant_premium(uuid) to authenticated;
grant execute on function public.confirm_merchant_plan_transfer(text, integer, text) to service_role;
grant execute on function public.merchant_plan_allows_orders(uuid) to anon, authenticated, service_role;
