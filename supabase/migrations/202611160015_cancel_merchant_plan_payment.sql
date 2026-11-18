alter table public.merchant_plan_payments
  add column cancelled_at timestamptz,
  add column received_amount_vnd integer check (received_amount_vnd > 0),
  drop constraint merchant_plan_payments_status_check,
  add constraint merchant_plan_payments_status_check
    check (status in ('pending', 'approved', 'expired', 'cancelled', 'needs_review')),
  add check ((status in ('cancelled', 'needs_review')) = (cancelled_at is not null)),
  add check (status <> 'needs_review' or (paid_at is not null and sepay_transaction_id is not null
    and received_amount_vnd is not null and valid_until is null));

create function public.cancel_merchant_plan_payment(payment_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  buyer uuid := auth.uid();
begin
  if buyer is null then raise exception 'sign_in_required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(buyer::text, 142));
  update public.merchant_plan_payments set status = 'cancelled', cancelled_at = now()
    where user_id = buyer and transfer_code = payment_code and status = 'pending';
  return found;
end;
$$;

revoke all on function public.cancel_merchant_plan_payment(text) from public, anon, authenticated;
grant execute on function public.cancel_merchant_plan_payment(text) to authenticated;

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
  if payment.status in ('approved', 'needs_review') then return 'already_paid'; end if;
  if payment.status = 'cancelled' then
    if received_amount is null or received_amount <= 0 then return 'amount_mismatch'; end if;
    update public.merchant_plan_payments set status = 'needs_review', paid_at = now(),
      sepay_transaction_id = transaction_id, received_amount_vnd = received_amount
      where id = payment.id;
    return 'cancelled_payment_needs_review';
  end if;
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
