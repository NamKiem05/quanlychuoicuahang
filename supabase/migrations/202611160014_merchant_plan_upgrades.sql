alter table public.merchant_plan_payments
  add column upgrade_amount_vnd integer check (upgrade_amount_vnd > 0),
  add column upgrade_expires_at timestamptz,
  add check ((upgrade_amount_vnd is null and upgrade_expires_at is null)
    or (plan = 'plus' and upgrade_amount_vnd is not null and upgrade_expires_at is not null)),
  drop constraint merchant_plan_payments_status_check,
  add constraint merchant_plan_payments_status_check check (status in ('pending', 'approved', 'expired'));

create function public.expire_merchant_plan_upgrades(buyer uuid)
returns void language sql set search_path = '' as $$
  update public.merchant_plan_payments set status = 'expired'
  where user_id = buyer and status = 'pending' and upgrade_expires_at <= now();
$$;
revoke all on function public.expire_merchant_plan_upgrades(uuid) from public, anon, authenticated;

create or replace function public.request_merchant_plan(requested_plan text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  buyer uuid := auth.uid();
  current_plan text;
  expiry timestamptz;
  upgrade_price integer;
begin
  if buyer is null or requested_plan is null or requested_plan not in ('basic', 'plus') then
    raise exception 'invalid_plan';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(buyer::text, 142));
  if exists (select 1 from public.store_members m join public.stores s on s.id = m.store_id
    where m.user_id = buyer and s.billing_owner_id is distinct from buyer) then
    raise exception 'existing_store';
  end if;
  perform public.expire_merchant_plan_upgrades(buyer);
  if exists (select 1 from public.merchant_plan_payments where user_id = buyer and status = 'pending') then return; end if;

  select plan, valid_until into current_plan, expiry from public.merchant_plan_payments
    where user_id = buyer and status = 'approved' and valid_until > now()
    order by valid_until desc, plan desc limit 1;
  if current_plan = 'basic' and requested_plan = 'plus' then
    upgrade_price := ceil(50000 * extract(epoch from (expiry - now()))
      / extract(epoch from (expiry - (expiry - interval '1 month'))));
    insert into public.merchant_plan_payments (user_id, plan, amount_vnd, upgrade_amount_vnd, upgrade_expires_at)
      values (buyer, 'plus', 99000, upgrade_price, expiry);
    return;
  end if;
  if current_plan is not null and current_plan <> requested_plan then raise exception 'active_plan_exists'; end if;
  insert into public.merchant_plan_payments (user_id, plan, amount_vnd)
    values (buyer, requested_plan, case requested_plan when 'basic' then 49000 else 99000 end);
end;
$$;

create or replace function public.confirm_merchant_plan_transfer(payment_code text, received_amount integer, transaction_id text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  payment public.merchant_plan_payments%rowtype;
  buyer uuid;
  prior_expiry timestamptz;
begin
  if transaction_id is null or char_length(transaction_id) not between 1 and 120 then
    raise exception 'invalid_transaction_id';
  end if;
  select user_id into buyer from public.merchant_plan_payments where transfer_code = payment_code;
  if not found then return 'unknown_code'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(buyer::text, 142));
  select * into payment from public.merchant_plan_payments where transfer_code = payment_code for update;
  if payment.status = 'approved' then return 'already_paid'; end if;
  if received_amount is distinct from coalesce(payment.upgrade_amount_vnd, payment.amount_vnd) then return 'amount_mismatch'; end if;

  select max(valid_until) into prior_expiry from public.merchant_plan_payments
    where user_id = buyer and status = 'approved';
  update public.merchant_plan_payments set status = 'approved', paid_at = now(),
    sepay_transaction_id = transaction_id,
    valid_until = coalesce(payment.upgrade_expires_at, greatest(now(), prior_expiry) + interval '1 month')
    where id = payment.id;
  if payment.upgrade_expires_at <= now() then return 'upgrade_paid_after_expiry'; end if;
  return 'activated';
exception when unique_violation then
  return 'duplicate_transaction';
end;
$$;

create or replace function public.has_merchant_premium(target_store uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or exists (
    select 1 from public.stores s where s.id = target_store and public.has_store_role(s.id) and (
      s.billing_owner_id is null or (
        select p.plan = 'plus' from public.merchant_plan_payments p
        where p.user_id = s.billing_owner_id and p.status = 'approved' and p.valid_until > now()
        order by p.valid_until desc, p.plan desc limit 1
      )
    )
  );
$$;
