-- Run after 202611250005 on a disposable test database. Fixtures are rolled back.
begin;
insert into auth.users(id,email,raw_app_meta_data) values
 ('95000000-0000-4000-8000-000000000001','overview-admin@example.invalid','{"account_kind":"platform_admin"}'),
 ('95000000-0000-4000-8000-000000000002','overview-merchant@example.invalid','{}');
insert into public.platform_admins(user_id) values ('95000000-0000-4000-8000-000000000001');
insert into auth.sessions(id,user_id,created_at,refreshed_at) values
 ('96000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001',now(),now()),
 ('96000000-0000-4000-8000-000000000002','95000000-0000-4000-8000-000000000002',now(),now());
insert into public.stores(id,name,slug,created_by,status) values
 ('97000000-0000-4000-8000-000000000001','Overview store A','overview-store-a','95000000-0000-4000-8000-000000000002','active'),
 ('97000000-0000-4000-8000-000000000002','Overview store B','overview-store-b','95000000-0000-4000-8000-000000000002','active'),
 ('97000000-0000-4000-8000-000000000003','Overview store C','overview-store-c','95000000-0000-4000-8000-000000000002','active');

do $$
declare
  admin_user constant uuid := '95000000-0000-4000-8000-000000000001';
  owner_user constant uuid := '95000000-0000-4000-8000-000000000002';
  shop_a constant uuid := '97000000-0000-4000-8000-000000000001';
  shop_b constant uuid := '97000000-0000-4000-8000-000000000002';
  shop_c constant uuid := '97000000-0000-4000-8000-000000000003';
  base constant jsonb := '{"preset":"green","style":"modern","order":["hero","menu","reviews","story"],"hidden":[],"headline":"Overview","density":"comfortable","settings":{"font":"system","radius":"soft","width":"standard","columns":[4,3,2]}}';
  admin_token constant text := '{"sub":"95000000-0000-4000-8000-000000000001","session_id":"96000000-0000-4000-8000-000000000001"}';
  owner_token constant text := '{"sub":"95000000-0000-4000-8000-000000000002","session_id":"96000000-0000-4000-8000-000000000002"}';
  before_report jsonb;
  report jsonb;
  premium uuid;
  free_theme uuid;
  premium_release uuid;
  free_release uuid;
  order_a uuid;
begin
  perform set_config('request.jwt.claims', admin_token, true);
  before_report := public.admin_theme_overview_report('2040-02-02','2040-02-03','day','revenue',0);
  if before_report#>>'{series,0,revenue}' is distinct from '0'
    or before_report->'activity' is distinct from '[]'::jsonb then
    raise exception 'empty interval should return zero series and no activity';
  end if;
  premium := public.admin_save_theme(null,0,'Overview premium','overview-premium','','general','{}',100000,null,base);
  premium_release := public.admin_publish_theme(premium,0,'1.0.0');
  free_theme := public.admin_save_theme(null,0,'Overview free','overview-free','','general','{}',0,null,base);
  free_release := public.admin_publish_theme(free_theme,0,'1.0.0');
  perform public.admin_theme_visibility(free_theme,false);

  -- Vietnam Feb 2 is [Feb 1 17:00 UTC, Feb 2 17:00 UTC).
  insert into public.storefront_theme_purchases(theme_id,version_id,store_id,amount_vnd,created_by,created_at,confirmed_by,confirmed_at,bank_reference)
  values(premium,premium_release,shop_a,100000,owner_user,'2040-02-01 16:59:59+00',admin_user,'2040-02-01 17:00:00+00','OVERVIEW-TEST-A')
  returning id into order_a;
  insert into public.storefront_theme_purchases(theme_id,version_id,store_id,amount_vnd,created_by,created_at,confirmed_by,confirmed_at,bank_reference)
  values(premium,premium_release,shop_b,90000,owner_user,'2040-02-02 16:59:59+00',admin_user,'2040-02-02 17:00:00+00','OVERVIEW-TEST-B'),
    (premium,premium_release,shop_c,80000,owner_user,'2040-02-02 16:59:59+00',null,null,null);
  insert into public.storefront_theme_licenses(store_id,theme_id,version_id,purchase_id,granted_at)
    values(shop_a,premium,premium_release,order_a,'2040-02-01 17:00:00+00');
  insert into public.storefront_theme_licenses(store_id,theme_id,version_id,granted_at,revoked_at,revoked_by,revocation_reason)
    values(shop_b,free_theme,free_release,'2040-01-01','2040-02-02 02:00:00+00',admin_user,'Test revocation');
  insert into public.storefront_theme_licenses(store_id,theme_id,version_id,granted_at,granted_by)
    values(shop_a,free_theme,free_release,'2040-01-01',admin_user);
  insert into public.storefront_store_theme(store_id,theme_id,version_id,installed_at,installed_by,is_active)
    values(shop_a,premium,premium_release,'2040-02-01 17:00:00+00',owner_user,true),
      (shop_a,free_theme,free_release,'2040-02-02 16:59:59+00',owner_user,false),
      (shop_b,free_theme,free_release,null,null,true);
  insert into public.support_tickets(store_id,created_by,subject,category)
    values(shop_a,owner_user,'Overview support ticket','website');

  set local role authenticated;
  report := public.admin_theme_overview_report('2040-02-02','2040-02-03','day','revenue',0);
  if report->'orders' is distinct from '{"total":2,"pending":1,"paid_orders":1,"paid":1,"value":170000,"received":100000}'::jsonb
    or report#>>'{series,0,revenue}' is distinct from '100000'
    or report#>>'{series,0,orders}' is distinct from '2'
    or report#>>'{series,0,paid}' is distinct from '1' then
    raise exception 'order cohort or payment date totals incorrect';
  end if;
  if (report#>>'{installation,total}')::int - (before_report#>>'{installation,total}')::int <> 3
    or (report#>>'{installation,active}')::int - (before_report#>>'{installation,active}')::int <> 2
    or (report#>>'{installation,stores}')::int - (before_report#>>'{installation,stores}')::int <> 1
    or (report#>>'{installation,unknown_date}')::int - (before_report#>>'{installation,unknown_date}')::int <> 1
    or report#>>'{installation,new_stores}' is distinct from '1'
    or report#>>'{series,0,installations}' is distinct from '2' then
    raise exception 'installation and distinct shop totals incorrect';
  end if;
  if (report#>>'{licenses,active}')::int - (before_report#>>'{licenses,active}')::int <> 2
    or (report#>>'{licenses,revoked}')::int - (before_report#>>'{licenses,revoked}')::int <> 1
    or (report#>>'{queue,pending}')::int - (before_report#>>'{queue,pending}')::int <> 1
    or (report#>>'{queue,missing_license}')::int - (before_report#>>'{queue,missing_license}')::int <> 1
    or (report#>>'{queue,support}')::int - (before_report#>>'{queue,support}')::int <> 1
    or (report#>>'{catalog,paused}')::int - (before_report#>>'{catalog,paused}')::int <> 1 then
    raise exception 'license, marketplace or queue totals incorrect';
  end if;
  if report#>>'{ranking,0,id}' is distinct from premium::text
    or not exists (select 1 from jsonb_array_elements(report->'activity') event where event->>'kind'='installed' and event->>'actor' is not null)
    or not exists (select 1 from jsonb_array_elements(report->'activity') event where event->>'kind'='revoked') then
    raise exception 'ranking or activity incorrect';
  end if;
  report := public.admin_theme_overview_report('2040-02-02','2040-02-03','week','installations',0);
  if report#>>'{series,0,date}' is distinct from date_trunc('week','2040-02-02'::timestamp)::date::text
    or report#>>'{series,0,installations}' is distinct from '2' then raise exception 'week bucket incorrect'; end if;
  report := public.admin_theme_overview_report('2040-02-02','2040-02-03','month','purchases',0);
  if report#>>'{series,0,date}' is distinct from '2040-02-01' then raise exception 'month bucket incorrect'; end if;
  begin
    perform public.admin_theme_overview_report('2040-02-03','2040-02-02','day','revenue',0);
    raise exception 'reversed range accepted';
  exception when invalid_parameter_value then null;
  end;
  perform set_config('request.jwt.claims', owner_token, true);
  begin
    perform public.admin_theme_overview_report('2040-02-02','2040-02-03','day','revenue',0);
    raise exception 'merchant read overview';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', '{"sub":"95000000-0000-4000-8000-000000000001","session_id":"96000000-0000-4000-8000-000000000099"}', true);
  begin
    perform public.admin_theme_overview_report('2040-02-02','2040-02-03','day','revenue',0);
    raise exception 'administrator without a live session read overview';
  exception when insufficient_privilege then null;
  end;
  if has_function_privilege('anon','public.admin_theme_overview_report(date,date,text,text,integer)','execute') then
    raise exception 'anonymous role can execute report';
  end if;
end $$;
rollback;
