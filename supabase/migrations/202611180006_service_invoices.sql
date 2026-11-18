-- Internal service documents only; this is not a tax e-invoice.
create table public.service_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number bigint generated always as identity unique,
  payment_id uuid not null unique references public.merchant_plan_payments(id) on delete restrict,
  customer_id uuid not null references auth.users(id) on delete restrict,
  customer_name text not null,
  plan_name text not null,
  amount_vnd integer not null check (amount_vnd >= 0),
  issued_at timestamptz not null default now(),
  issued_by uuid not null references auth.users(id),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id),
  cancellation_reason text,
  check ((cancelled_at is null and cancelled_by is null and cancellation_reason is null) or
    (cancelled_at is not null and cancelled_by is not null and char_length(trim(cancellation_reason)) between 5 and 500))
);
alter table public.service_invoices enable row level security;
revoke all on public.service_invoices from public, anon, authenticated;
grant select on public.service_invoices to authenticated;
create policy service_invoices_admin_read on public.service_invoices for select to authenticated using ((select public.is_platform_admin()));

create function public.admin_create_service_invoice(requested_payment uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare p public.merchant_plan_payments%rowtype; result uuid; customer text;
begin
  if public.is_platform_admin() is not true then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into p from public.merchant_plan_payments where id = requested_payment for update;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
  if p.status not in ('pending', 'approved') or (p.upgrade_expires_at is not null and p.paid_at is not null and p.paid_at >= p.upgrade_expires_at) then
    raise exception 'payment requires reconciliation' using errcode = '22023';
  end if;
  select coalesce(nullif(trim(display_name), ''), 'Tài khoản ' || p.user_id::text) into customer from public.profiles where id = p.user_id;
  customer := coalesce(customer, 'Tài khoản ' || p.user_id::text);
  insert into public.service_invoices(payment_id, customer_id, customer_name, plan_name, amount_vnd, issued_by)
  values (p.id, p.user_id, customer, case p.plan when 'basic' then 'Gói Cơ bản' when 'plus' then 'Gói Nâng cao' else p.plan end, coalesce(p.upgrade_amount_vnd, p.amount_vnd), auth.uid())
  on conflict (payment_id) do nothing returning id into result;
  if result is null then select id into result from public.service_invoices where payment_id = p.id; end if;
  return result;
end;
$$;

create function public.admin_cancel_service_invoice(requested_invoice uuid, reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare inv public.service_invoices%rowtype; p public.merchant_plan_payments%rowtype;
begin
  if public.is_platform_admin() is not true then raise exception 'not authorized' using errcode = '42501'; end if;
  if char_length(trim(coalesce(reason, ''))) not between 5 and 500 then raise exception 'invalid reason' using errcode = '22023'; end if;
  select * into inv from public.service_invoices where id = requested_invoice for update;
  if not found or inv.cancelled_at is not null then raise exception 'invoice unavailable' using errcode = 'P0002'; end if;
  select * into p from public.merchant_plan_payments where id = inv.payment_id for update;
  if p.status <> 'pending' then raise exception 'only unpaid pending invoices can be cancelled' using errcode = '22023'; end if;
  update public.service_invoices set cancelled_at = now(), cancelled_by = auth.uid(), cancellation_reason = trim(reason) where id = inv.id;
end;
$$;
revoke all on function public.admin_create_service_invoice(uuid), public.admin_cancel_service_invoice(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_create_service_invoice(uuid), public.admin_cancel_service_invoice(uuid, text) to authenticated;

create view public.admin_service_invoice_view with (security_invoker = true) as
select i.*, p.transfer_code, p.paid_at, p.status as payment_status,
  case when i.cancelled_at is not null then 'cancelled'
    when p.status = 'approved' and (p.upgrade_expires_at is null or p.paid_at < p.upgrade_expires_at) then 'paid'
    when p.status = 'pending' then 'unpaid'
    else 'review' end as invoice_status
from public.service_invoices i join public.merchant_plan_payments p on p.id = i.payment_id;
grant select on public.admin_service_invoice_view to authenticated;
