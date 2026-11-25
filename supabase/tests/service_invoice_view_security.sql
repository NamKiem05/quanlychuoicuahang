-- Run on a disposable GrowDesk test database after 202611180006. Fixtures are rolled back.
begin;

insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
  ('41000000-0000-4000-8000-000000000081', 'invoice-admin@example.invalid', now(), '{"account_kind":"platform_admin"}', '{}'),
  ('41000000-0000-4000-8000-000000000082', 'invoice-customer@example.invalid', now(), '{}', '{}');
insert into public.platform_admins (user_id) values ('41000000-0000-4000-8000-000000000081');
insert into auth.sessions (id, user_id, created_at, refreshed_at) values
  ('44000000-0000-4000-8000-000000000081', '41000000-0000-4000-8000-000000000081', now(), now()),
  ('44000000-0000-4000-8000-000000000082', '41000000-0000-4000-8000-000000000082', now(), now());

set local role service_role;
insert into public.merchant_plan_payments (id, user_id, plan, amount_vnd)
values ('42000000-0000-4000-8000-000000000081', '41000000-0000-4000-8000-000000000082', 'basic', 49000);
insert into public.service_invoices (id, payment_id, customer_id, customer_name, plan_name, amount_vnd, issued_by)
values ('43000000-0000-4000-8000-000000000081', '42000000-0000-4000-8000-000000000081',
  '41000000-0000-4000-8000-000000000082', 'Khách kiểm thử', 'Gói Cơ bản', 49000,
  '41000000-0000-4000-8000-000000000081');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000082","session_id":"44000000-0000-4000-8000-000000000082"}', true);
do $$
begin
  if (select count(*) from public.merchant_plan_payments where id = '42000000-0000-4000-8000-000000000081') <> 1 then
    raise exception 'fixture customer should be able to see their own payment';
  end if;
  if (select count(*) from public.service_invoices where id = '43000000-0000-4000-8000-000000000081') <> 0 then
    raise exception 'non-admin can read service invoice table';
  end if;
  if (select count(*) from public.admin_service_invoice_view where id = '43000000-0000-4000-8000-000000000081') <> 0 then
    raise exception 'non-admin can read service invoice view';
  end if;

  perform set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000081","session_id":"44000000-0000-4000-8000-000000000081"}', true);
  if (select count(*) from public.admin_service_invoice_view where id = '43000000-0000-4000-8000-000000000081') <> 1 then
    raise exception 'platform admin cannot read service invoice view';
  end if;
end;
$$;

rollback;
