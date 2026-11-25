-- Run on a disposable GrowDesk database after 202611250001. All fixtures roll back.
begin;

insert into auth.users (id, email, raw_app_meta_data) values
  ('51000000-0000-4000-8000-000000000001', 'invoice-platform@example.invalid', '{"account_kind":"platform_admin"}'),
  ('51000000-0000-4000-8000-000000000002', 'invoice-owner-one@example.invalid', '{}'),
  ('51000000-0000-4000-8000-000000000003', 'invoice-owner-two@example.invalid', '{}');
insert into public.platform_admins (user_id) values ('51000000-0000-4000-8000-000000000001');
insert into auth.sessions (id, user_id, created_at, refreshed_at) values
  ('52000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', now(), now()),
  ('52000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000002', now(), now());
insert into public.merchant_plan_payments (id, user_id, plan, amount_vnd, created_at) values
  ('53000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002', 'basic', 49000, now() - interval '5 days'),
  ('53000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000003', 'plus', 99000, now() - interval '5 days');

set local role authenticated;
do $$
declare
  first_id uuid;
  second_id uuid;
  today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  perform set_config('request.jwt.claims', '{"sub":"51000000-0000-4000-8000-000000000001","session_id":"52000000-0000-4000-8000-000000000001"}', true);
  first_id := public.admin_issue_service_invoice('53000000-0000-4000-8000-000000000001', today - 3, today - 1, 'Dịch vụ', 'Nội bộ');
  if first_id is distinct from public.admin_issue_service_invoice('53000000-0000-4000-8000-000000000001', today, today, null, null) then
    raise exception 'reissue created another invoice';
  end if;
  if not exists (select 1 from public.admin_service_invoice_view where id = first_id and invoice_status = 'overdue' and balance_vnd = 49000) then
    raise exception 'unpaid invoice is missing its balance or overdue state';
  end if;
  if (select status from public.merchant_plan_payments where id = '53000000-0000-4000-8000-000000000001') <> 'pending' then
    raise exception 'issuing an invoice activated service';
  end if;

  begin
    perform public.admin_record_service_invoice_transfer(first_id, 49001, now(), 'BANK-TEST-001', null);
    raise exception 'overpayment was accepted';
  exception when sqlstate '22023' then null;
  end;
  perform public.admin_record_service_invoice_transfer(first_id, 49000, now(), 'BANK-TEST-001', 'Đã đối chiếu sao kê');
  perform public.admin_record_service_invoice_transfer(first_id, 49000, now(), 'bank-test-001', 'Retry');
  if not exists (select 1 from public.admin_service_invoice_view where id = first_id and invoice_status = 'paid' and paid_vnd = 49000
    and balance_vnd = 0 and bank_note = 'Đã đối chiếu sao kê' and bank_recorded_by = auth.uid()) then
    raise exception 'receipt balance, audit, or idempotency is incorrect';
  end if;
  begin
    perform public.admin_cancel_service_invoice(first_id, 'Không được hủy khi đã thu');
    raise exception 'paid invoice was cancelled';
  exception when sqlstate '22023' then null;
  end;

  second_id := public.admin_issue_service_invoice('53000000-0000-4000-8000-000000000002', today, today, null, null);
  begin
    perform public.admin_record_service_invoice_transfer(second_id, 99000, now(), 'BANK-TEST-001', null);
    raise exception 'duplicate receipt was accepted';
  exception when unique_violation then null;
  end;
  perform public.admin_cancel_service_invoice(second_id, 'Yêu cầu hủy hợp lệ');
  if not exists (select 1 from public.admin_service_invoice_view where id = second_id and invoice_status = 'cancelled' and balance_vnd = 0 and cancelled_by = auth.uid()) then
    raise exception 'cancellation did not release receivable or preserve audit';
  end if;

  perform set_config('request.jwt.claims', '{"sub":"51000000-0000-4000-8000-000000000002","session_id":"52000000-0000-4000-8000-000000000002"}', true);
  if has_column_privilege('authenticated', 'public.stores', 'billing_owner_id', 'SELECT')
    or exists (select 1 from public.admin_invoice_billing_store(auth.uid())) then
    raise exception 'billing-owner mapping is exposed to authenticated users';
  end if;
  if (select count(*) from public.my_service_invoices()) <> 1 or exists (select 1 from public.admin_service_invoice_view where id in (first_id, second_id)) then
    raise exception 'tenant isolation failed';
  end if;
  begin
    perform public.admin_cancel_service_invoice(first_id, 'Không có quyền hủy');
    raise exception 'non-admin managed invoice';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claims', '{"sub":"51000000-0000-4000-8000-000000000001","session_id":"52000000-0000-4000-8000-000000000002"}', true);
  if exists (select 1 from public.admin_service_invoice_view where id = first_id) then raise exception 'invalid session can read invoices'; end if;
end;
$$;
rollback;
