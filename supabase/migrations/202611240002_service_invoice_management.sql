begin;

alter table public.service_invoices
  add column created_at timestamptz,
  add column due_on date,
  add column store_id uuid references public.stores(id) on delete set null,
  add column store_name text,
  add column description text check (char_length(description) <= 500),
  add column internal_note text check (char_length(internal_note) <= 1000),
  add column bank_note text check (char_length(bank_note) <= 1000),
  add column bank_recorded_by uuid references auth.users(id),
  add column bank_recorded_at timestamptz,
  add column service_starts_at timestamptz,
  add constraint service_invoice_due_order check (due_on >= (issued_at at time zone 'Asia/Ho_Chi_Minh')::date);
alter table public.service_invoices alter column created_at set default now();

alter table public.merchant_plan_payments
  add column bank_reference text unique,
  drop constraint merchant_plan_payments_check,
  add constraint merchant_plan_approved_evidence check ((status = 'approved') =
    (paid_at is not null and (sepay_transaction_id is not null or bank_reference is not null) and valid_until is not null)),
  add constraint merchant_plan_manual_evidence check (
    bank_reference is null
    or (status = 'approved' and sepay_transaction_id is null and received_amount_vnd is not null)
  );

create policy service_invoices_live_session on public.service_invoices as restrictive
  for select to authenticated using ((select public.growdesk_session_is_active()));
create index service_invoices_issued_order on public.service_invoices (issued_at, invoice_number);
create index service_invoices_due_date on public.service_invoices (due_on) where cancelled_at is null;

-- Preserve the original signature for existing callers, including plan payments.
create function public.admin_issue_service_invoice(
  requested_payment uuid, issue_on date, due_date date, service_description text, note text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  invoice_id uuid;
  payment_started timestamptz;
  today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if public.is_platform_admin() is not true or public.growdesk_session_is_active() is not true then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if issue_on is null or due_date is null or due_date < issue_on or issue_on > today
     or char_length(service_description) > 500 or char_length(note) > 1000 then
    raise exception 'invalid invoice details' using errcode = '22023';
  end if;
  select created_at into payment_started from public.merchant_plan_payments where id = requested_payment for update;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
  select id into invoice_id from public.service_invoices where payment_id = requested_payment;
  if found then return invoice_id; end if;
  if issue_on < (payment_started at time zone 'Asia/Ho_Chi_Minh')::date then
    raise exception 'invoice predates payment request' using errcode = '22023';
  end if;

  invoice_id := public.admin_create_service_invoice(requested_payment);
  update public.service_invoices
  set due_on = due_date, issued_at = case when issue_on = today then issued_at
    else issue_on::timestamp at time zone 'Asia/Ho_Chi_Minh' end,
    description = nullif(btrim(service_description), ''), internal_note = nullif(btrim(note), '')
  where id = invoice_id;
  return invoice_id;
end;
$$;

-- Also protect older RPC entry points that may be called separately.
create or replace function public.admin_create_service_invoice(requested_payment uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare p public.merchant_plan_payments%rowtype; result uuid; customer text;
begin
  if public.is_platform_admin() is not true or public.growdesk_session_is_active() is not true then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into p from public.merchant_plan_payments where id = requested_payment for update;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
  select id into result from public.service_invoices where payment_id = p.id;
  if found then return result; end if;
  if p.status not in ('pending', 'approved') or (p.upgrade_expires_at is not null and
    coalesce(p.paid_at, now()) >= p.upgrade_expires_at) then
    raise exception 'payment requires reconciliation' using errcode = '22023';
  end if;
  select coalesce(nullif(trim(display_name), ''), 'Tài khoản ' || p.user_id::text) into customer from public.profiles where id = p.user_id;
  insert into public.service_invoices(payment_id, customer_id, customer_name, plan_name, amount_vnd, issued_by, store_id, store_name)
  values (p.id, p.user_id, coalesce(customer, 'Tài khoản ' || p.user_id::text),
    case p.plan when 'basic' then 'Gói Cơ bản' when 'plus' then 'Gói Nâng cao' else p.plan end,
    coalesce(p.upgrade_amount_vnd, p.amount_vnd), auth.uid(),
    (select id from public.stores where billing_owner_id = p.user_id),
    (select name from public.stores where billing_owner_id = p.user_id))
  returning id into result;
  return result;
end;
$$;

create or replace function public.admin_cancel_service_invoice(requested_invoice uuid, reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare inv public.service_invoices%rowtype; payment uuid; payment_status text;
begin
  if public.is_platform_admin() is not true or public.growdesk_session_is_active() is not true then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(reason, ''))) not between 5 and 500 then
    raise exception 'invalid reason' using errcode = '22023';
  end if;
  select payment_id into payment from public.service_invoices where id = requested_invoice;
  select status into payment_status from public.merchant_plan_payments where id = payment for update;
  select * into inv from public.service_invoices where id = requested_invoice for update;
  if not found then raise exception 'invoice unavailable' using errcode = 'P0002'; end if;
  if inv.cancelled_at is not null then return; end if;
  if payment_status is distinct from 'pending' then
    raise exception 'only unpaid pending invoices can be cancelled' using errcode = '22023';
  end if;
  update public.service_invoices set cancelled_at = now(), cancelled_by = auth.uid(), cancellation_reason = trim(reason)
  where id = inv.id;
end;
$$;

create function public.admin_record_service_invoice_transfer(
  requested_invoice uuid, amount integer, paid_on timestamptz, reference text, note text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  inv public.service_invoices%rowtype;
  p public.merchant_plan_payments%rowtype;
  buyer uuid;
  requested_payment uuid;
  prior_expiry timestamptz;
  recorded_at timestamptz := now();
  normalized_reference text := upper(btrim(reference));
begin
  if public.is_platform_admin() is not true or public.growdesk_session_is_active() is not true then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if amount is null or amount <= 0 or paid_on is null or paid_on > recorded_at
    or normalized_reference is null or normalized_reference !~ '^[A-Z0-9][A-Z0-9 ./_-]{2,119}$'
    or char_length(note) > 1000 then raise exception 'invalid transfer' using errcode = '22023'; end if;
  select payment_id, customer_id into requested_payment, buyer from public.service_invoices where id = requested_invoice;
  if not found then raise exception 'invoice unavailable' using errcode = 'P0002'; end if;
  -- Use the same customer lock and lock order as the SePay workflow.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(buyer::text, 142));
  select * into p from public.merchant_plan_payments where id = requested_payment for update;
  select * into inv from public.service_invoices where id = requested_invoice for update;
  if p.bank_reference = normalized_reference and p.received_amount_vnd = amount and p.paid_at = paid_on then return; end if;
  if p.user_id is distinct from inv.customer_id or inv.cancelled_at is not null
     or p.status <> 'pending' or paid_on < p.created_at
     or amount is distinct from inv.amount_vnd or amount is distinct from coalesce(p.upgrade_amount_vnd, p.amount_vnd)
     or p.upgrade_expires_at <= recorded_at then
    raise exception 'transfer requires reconciliation' using errcode = '22023';
  end if;
  select max(valid_until) into prior_expiry from public.merchant_plan_payments where user_id = buyer and status = 'approved';
  update public.merchant_plan_payments set status = 'approved', paid_at = paid_on, received_amount_vnd = amount,
    bank_reference = normalized_reference,
    valid_until = coalesce(p.upgrade_expires_at, greatest(recorded_at, prior_expiry) + interval '1 month')
  where id = p.id;
  update public.service_invoices set bank_note = nullif(btrim(note), ''),
    bank_recorded_by = auth.uid(), bank_recorded_at = recorded_at,
    service_starts_at = case when p.upgrade_expires_at is not null then recorded_at else greatest(recorded_at, prior_expiry) end
  where id = inv.id;
end;
$$;

revoke all on function public.admin_issue_service_invoice(uuid,date,date,text,text),
  public.admin_record_service_invoice_transfer(uuid,integer,timestamptz,text,text) from public, anon, authenticated;
grant execute on function public.admin_issue_service_invoice(uuid,date,date,text,text),
  public.admin_record_service_invoice_transfer(uuid,integer,timestamptz,text,text) to authenticated;

create or replace view public.admin_service_invoice_view with (security_invoker = true) as
select i.id, i.invoice_number, i.payment_id, i.customer_id, i.customer_name, i.plan_name, i.amount_vnd,
  i.issued_at, i.issued_by, i.cancelled_at, i.cancelled_by, i.cancellation_reason,
  p.transfer_code, p.paid_at, p.status as payment_status,
  case when i.cancelled_at is not null then 'cancelled'
    when p.status = 'approved' and (p.upgrade_expires_at is null or p.paid_at < p.upgrade_expires_at) then 'paid'
    when p.status = 'pending' and p.upgrade_expires_at <= now() then 'review'
    when p.status = 'pending' and i.due_on < (now() at time zone 'Asia/Ho_Chi_Minh')::date then 'overdue'
    when p.status = 'pending' then 'unpaid' else 'review' end as invoice_status,
  i.due_on, coalesce(i.store_id, s.id) as store_id, coalesce(i.store_name, s.name) as store_name, s.slug as store_slug,
  i.description, i.internal_note, i.bank_note, p.plan as plan_code,
  p.valid_until, p.upgrade_expires_at, p.created_at as payment_requested_at,
  coalesce(p.bank_reference, p.sepay_transaction_id) as transaction_reference,
  case when p.bank_reference is not null then 'bank' when p.sepay_transaction_id is not null then 'sepay' end as payment_method,
  i.bank_recorded_by, i.bank_recorded_at, p.received_amount_vnd,
  case when i.cancelled_at is null and p.status = 'approved'
    and (p.upgrade_expires_at is null or p.paid_at < p.upgrade_expires_at) then i.amount_vnd else 0 end as paid_vnd,
  case when i.cancelled_at is null and p.status = 'pending' and (p.upgrade_expires_at is null or p.upgrade_expires_at > now())
    then i.amount_vnd else 0 end as balance_vnd,
  greatest(0, (now() at time zone 'Asia/Ho_Chi_Minh')::date - i.due_on) as days_past_due,
  i.created_at, greatest(i.created_at, i.issued_at, i.cancelled_at, i.bank_recorded_at, p.paid_at) as updated_at,
  i.service_starts_at, s.phone as store_phone
from public.service_invoices i
join public.merchant_plan_payments p on p.id = i.payment_id and p.user_id = i.customer_id
left join public.stores s on s.id = i.store_id or (i.store_id is null and i.store_name is null and s.billing_owner_id = i.customer_id);

create function public.admin_service_invoice_summary()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'total', count(*), 'value', coalesce(sum(amount_vnd), 0),
    'paid_value', coalesce(sum(paid_vnd), 0), 'balance', coalesce(sum(balance_vnd), 0),
    'paid', count(*) filter (where invoice_status = 'paid'),
    'unpaid', count(*) filter (where invoice_status in ('unpaid', 'overdue')),
    'overdue', count(*) filter (where invoice_status = 'overdue'),
    'cancelled', count(*) filter (where invoice_status = 'cancelled'),
    'review', count(*) filter (where invoice_status = 'review'),
    'due_soon', count(*) filter (where invoice_status = 'unpaid' and due_on <= (now() at time zone 'Asia/Ho_Chi_Minh')::date + 7),
    'debtors', (select coalesce(jsonb_agg(to_jsonb(debtor) order by debtor.balance desc, debtor.customer_id, debtor.store_id), '[]'::jsonb)
      from (select v.customer_id, v.store_id, max(coalesce(v.store_name,v.customer_name)) as name, sum(v.balance_vnd) as balance
        from public.admin_service_invoice_view v where v.balance_vnd > 0
        group by v.customer_id, v.store_id order by balance desc, v.customer_id, v.store_id limit 20) debtor)
  ) from public.admin_service_invoice_view
  where public.is_platform_admin() and public.growdesk_session_is_active();
$$;

create function public.my_service_invoices()
returns table(invoice_number bigint, plan_name text, amount_vnd integer, issued_at timestamptz, due_on date,
  paid_vnd integer, balance_vnd integer, status text, transfer_code text)
language sql stable security definer set search_path = '' as $$
  select i.invoice_number, i.plan_name, i.amount_vnd, i.issued_at, i.due_on, i.paid_vnd, i.balance_vnd,
    i.invoice_status, i.transfer_code from public.admin_service_invoice_view i
  where i.customer_id = auth.uid() and public.growdesk_session_is_active()
  order by i.issued_at desc, i.invoice_number desc limit 50;
$$;

revoke all on function public.admin_service_invoice_summary(), public.my_service_invoices() from public, anon, authenticated;
grant execute on function public.admin_service_invoice_summary(), public.my_service_invoices() to authenticated;

create function public.admin_service_invoice_candidates(term text, requested_plan text)
returns table(id uuid, plan text, transfer_code text, amount_vnd integer, store_name text, store_slug text, customer_name text)
language sql stable security invoker set search_path = '' as $$
  select p.id, p.plan, p.transfer_code, coalesce(p.upgrade_amount_vnd, p.amount_vnd), s.name, s.slug,
    coalesce(nullif(btrim(pr.display_name), ''), 'Tài khoản ' || p.user_id::text)
  from public.merchant_plan_payments p
  left join public.stores s on s.billing_owner_id = p.user_id
  left join public.profiles pr on pr.id = p.user_id
  where public.is_platform_admin() and public.growdesk_session_is_active()
    and p.status in ('pending', 'approved')
    and (p.upgrade_expires_at is null or coalesce(p.paid_at, now()) < p.upgrade_expires_at)
    and not exists (select 1 from public.service_invoices i where i.payment_id = p.id)
    and (requested_plan is null or p.plan = requested_plan)
    and (coalesce(term, '') = '' or strpos(lower(concat_ws(' ', s.name, s.slug, pr.display_name, p.transfer_code)), lower(left(term, 80))) > 0)
  order by p.created_at desc, p.id limit 30;
$$;
revoke all on function public.admin_service_invoice_candidates(text,text) from public, anon, authenticated;
grant execute on function public.admin_service_invoice_candidates(text,text) to authenticated;
commit;
