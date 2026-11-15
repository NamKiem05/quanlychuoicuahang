-- Mark cash orders as paid when the store completes fulfillment.
-- Bank-transfer orders still require explicit payment confirmation.

create or replace function public.set_cash_payment_paid_on_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'completed'
    and old.status is distinct from new.status
    and new.payment_method in ('cash_on_pickup', 'cash_on_delivery')
    and new.payment_status is distinct from 'paid' then
    new.payment_status := 'paid';
    new.payment_confirmed_at := coalesce(new.payment_confirmed_at, now());
    new.payment_confirmed_by := coalesce(new.payment_confirmed_by, auth.uid());
  end if;

  return new;
end;
$$;

drop trigger if exists orders_mark_cash_paid_on_completion on public.orders;
create trigger orders_mark_cash_paid_on_completion
  before update of status on public.orders
  for each row
  execute function public.set_cash_payment_paid_on_completion();

-- Repair cash orders that were already completed before this rule existed.
update public.orders
set payment_status = 'paid',
    payment_confirmed_at = coalesce(payment_confirmed_at, updated_at)
where status = 'completed'
  and payment_method in ('cash_on_pickup', 'cash_on_delivery')
  and payment_status <> 'paid';
