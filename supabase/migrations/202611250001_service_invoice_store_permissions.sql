begin;

-- Billing owner IDs are intentionally excluded from SELECT grants on stores.
create function public.admin_invoice_billing_store(buyer uuid)
returns table(id uuid, name text, slug text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name, s.slug from public.stores s
  where s.billing_owner_id = buyer and public.is_platform_admin()
    and public.growdesk_session_is_active();
$$;
revoke all on function public.admin_invoice_billing_store(uuid) from public, anon, authenticated;
grant execute on function public.admin_invoice_billing_store(uuid) to authenticated;

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
left join lateral public.admin_invoice_billing_store(case when i.store_id is null and i.store_name is null then i.customer_id end) legacy on true
left join public.stores s on s.id = coalesce(i.store_id, legacy.id);

create or replace function public.admin_service_invoice_candidates(term text, requested_plan text)
returns table(id uuid, plan text, transfer_code text, amount_vnd integer, store_name text, store_slug text, customer_name text)
language sql stable security invoker set search_path = '' as $$
  select p.id, p.plan, p.transfer_code, coalesce(p.upgrade_amount_vnd, p.amount_vnd), s.name, s.slug,
    coalesce(nullif(btrim(pr.display_name), ''), 'Tài khoản ' || p.user_id::text)
  from public.merchant_plan_payments p
  left join lateral public.admin_invoice_billing_store(p.user_id) s on true
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
