-- Disposable PostgreSQL after 202611250010. Fixtures are rolled back.
begin;
insert into auth.users(id,email,raw_app_meta_data) values
 ('9c000000-0000-4000-8000-000000000001','version-admin@example.invalid','{"account_kind":"platform_admin"}'),
 ('9c000000-0000-4000-8000-000000000002','version-owner@example.invalid','{}');
insert into public.platform_admins(user_id) values ('9c000000-0000-4000-8000-000000000001');
insert into auth.sessions(id,user_id,created_at,refreshed_at) values
 ('9c000000-0000-4000-8000-000000000011','9c000000-0000-4000-8000-000000000001',now(),now()),
 ('9c000000-0000-4000-8000-000000000012','9c000000-0000-4000-8000-000000000002',now(),now());
insert into public.stores(id,name,slug,created_by,status) values
 ('9c000000-0000-4000-8000-000000000021','Version store','version-management-test','9c000000-0000-4000-8000-000000000002','active');
insert into public.store_members(store_id,user_id,role) values
 ('9c000000-0000-4000-8000-000000000021','9c000000-0000-4000-8000-000000000002','owner');
set local role authenticated;
do $$
declare
 admin_token constant text := '{"sub":"9c000000-0000-4000-8000-000000000001","session_id":"9c000000-0000-4000-8000-000000000011"}';
 owner_token constant text := '{"sub":"9c000000-0000-4000-8000-000000000002","session_id":"9c000000-0000-4000-8000-000000000012"}';
 shop constant uuid := '9c000000-0000-4000-8000-000000000021';
 original constant jsonb := '{"preset":"green","style":"modern","order":["hero","menu","reviews","story"],"hidden":[],"headline":"Base","density":"comfortable","settings":{"font":"system","radius":"soft","width":"standard","columns":[4,3,2]},"schemaVersion":2,"pages":[{"id":"81000000-0000-4000-8000-000000000001","kind":"custom","slug":"version-test","title":"Page","description":"","visible":true,"blocks":[{"id":"81000000-0000-4000-8000-000000000002","kind":"announcement","title":"Banner","copy":"","limit":6,"hidden":false}]}]}';
 customized jsonb := jsonb_set(jsonb_set(original,'{headline}','"Merchant"'),'{pages,0,blocks,0,copy}','"Merchant copy"');
 revised jsonb := jsonb_set(jsonb_set(original,'{preset}','"blue"'),'{pages,0,blocks,0,title}','"New heading"');
 conflict_config jsonb := jsonb_set(revised,'{headline}','"Platform"');
 expected jsonb := jsonb_set(jsonb_set(revised,'{headline}','"Merchant"'),'{pages,0,blocks,0,copy}','"Merchant copy"');
 theme uuid;
 v1 uuid;
 v2 uuid;
 v3 uuid;
 order_id uuid;
 report jsonb;
 result jsonb;
 restored integer;
begin
 perform set_config('request.jwt.claims',admin_token,true);
 perform public.admin_update_theme_policy(true,null,'{}');
 theme := public.admin_save_theme(null,0,'Version fixture','version-fixture','','general','{}',50000,null,original);
 v1 := public.admin_release_theme(theme,0,'1.0.0','Initial','First notes','major','');
 perform set_config('request.jwt.claims',owner_token,true);
 order_id := public.claim_store_theme(shop,theme,v1);
 begin
  perform public.admin_release_theme(theme,1,'1.0.1','Unauthorized','','patch','');
  raise exception 'merchant released platform snapshot';
 exception when insufficient_privilege then null;
 end;
 perform set_config('request.jwt.claims',admin_token,true);
 perform public.admin_confirm_theme_transfer(order_id,50000,'THEME-VERSION-TEST');
 perform public.admin_autosave_theme(theme,1,revised);
 begin
  perform public.admin_release_theme(theme,2,'1.0.0','Duplicate','','patch','');
  raise exception 'duplicate version accepted';
 exception when unique_violation or sqlstate 'PT422' then null;
 end;
 begin
  perform public.admin_release_theme(theme,2,'1.0.1','Wrong type','','major','');
  raise exception 'version bump type mismatch accepted';
 exception when sqlstate 'PT422' then null;
 end;
 perform public.admin_theme_visibility(theme,false);
 v2 := public.admin_release_theme(theme,2,'1.0.1','Catalog changes','Second notes','patch','Manual');
 if (select manifest from public.storefront_theme_versions where id=v1) is distinct from original
  or (select previous_version_id from public.storefront_theme_versions where id=v2) is distinct from v1
  or (select is_enabled from public.storefront_template_catalog where id=theme) then raise exception 'snapshot or visibility changed unexpectedly'; end if;
 perform set_config('request.jwt.claims',owner_token,true);
 perform public.activate_store_theme(shop,theme);
 perform public.save_store_theme(shop,theme,0,customized,'draft');
 perform public.save_store_theme(shop,theme,1,null,'publish');
 perform set_config('request.jwt.claims',admin_token,true);
 report := public.admin_theme_version_report(theme,0,0,'outdated',null,v2);
 if report->>'current' is distinct from '1.0.0' or report->>'latest' is distinct from '1.0.1'
  or report->>'outdated' is distinct from '1' or report#>>'{detail,eligible}' is distinct from '1'
  or report#>>'{detail,release_notes}' is distinct from 'Second notes'
  or report#>>'{installations,0,version}' is distinct from '1.0.0' then raise exception 'version report incorrect'; end if;
 perform set_config('request.jwt.claims',owner_token,true);
 result := public.apply_store_theme_release(shop,theme,v2,2);
 if result->>'status' is distinct from 'success' or public.get_public_store_theme(shop) is distinct from expected then
  raise exception 'successful update did not merge base and merchant changes: %',result;
 end if;
 result := public.apply_store_theme_release(shop,theme,v2,2);
 if result->>'unchanged' is distinct from 'true' then raise exception 'retry was not idempotent'; end if;
 result := public.apply_store_theme_release(shop,theme,v1,3);
 if result->>'status' is distinct from 'success' or public.get_public_store_theme(shop) is distinct from customized then
  raise exception 'rollback lost customization';
 end if;
 result := public.apply_store_theme_release(shop,theme,v2,3);
 if result->>'status' is distinct from 'conflict' or public.get_public_store_theme(shop) is distinct from customized then
  raise exception 'stale request changed current version';
 end if;
 result := public.apply_store_theme_release(shop,theme,v2,4);
 if result->>'status' is distinct from 'success' then raise exception 'valid retry failed'; end if;
 perform set_config('request.jwt.claims',admin_token,true);
 perform public.admin_autosave_theme(theme,3,conflict_config);
 v3 := public.admin_release_theme(theme,4,'1.0.2','Conflicting headline','','patch','Review customized headlines');
 perform set_config('request.jwt.claims',owner_token,true);
 result := public.apply_store_theme_release(shop,theme,v3,5);
 if result->>'status' is distinct from 'incompatible' or result->>'issue' is distinct from '/headline'
  or public.get_public_store_theme(shop) is distinct from expected then raise exception 'merge conflict mutated storage: %',result; end if;
 perform set_config('request.jwt.claims',admin_token,true);
 report := public.admin_theme_version_report(theme,0,0,'failed',null);
 if report->>'store_count' is distinct from '1' or report#>>'{events,0,status}' is distinct from 'incompatible' then
  raise exception 'failed attempts were not retained';
 end if;
 perform set_config('request.jwt.claims',owner_token,true);
 perform public.save_store_theme(shop,theme,5,jsonb_set(expected,'{headline}','"Base"'),'draft');
 perform public.save_store_theme(shop,theme,6,null,'publish');
 result := public.apply_store_theme_release(shop,theme,v3,7);
 if result->>'status' is distinct from 'success' or (public.get_public_store_theme(shop)->>'headline') is distinct from 'Platform'
  or (public.get_public_store_theme(shop)#>>'{pages,0,blocks,0,copy}') is distinct from 'Merchant copy' then
  raise exception 'resolved retry did not preserve independent overrides';
 end if;
 perform set_config('request.jwt.claims',admin_token,true);
 restored := public.admin_restore_theme_version(theme,v1,5);
 if restored<>6 or (select draft from public.storefront_template_catalog where id=theme) is distinct from original
  or (select manifest from public.storefront_theme_versions where id=v3) is distinct from conflict_config
  or (select count(*) from public.storefront_theme_versions where theme_id=theme)<>3
  or (select version_id from public.storefront_theme_licenses where theme_id=theme and store_id=shop) is distinct from v1
  or (select version_id from public.storefront_theme_purchases where id=order_id) is distinct from v1 then
  raise exception 'restore changed snapshots, license or purchase';
 end if;
 perform public.admin_autosave_theme(theme,6,jsonb_set(original,'{pages,0,blocks,0,image}',
   '"theme-studio/81000000-0000-4000-8000-000000000001/81000000-0000-4000-8000-000000000002.webp"'));
 begin
  perform public.admin_release_theme(theme,7,'1.0.3','Missing asset','','patch','');
  raise exception 'missing managed asset accepted';
 exception when sqlstate 'PT423' then null;
 end;
 if (select count(*) from public.storefront_theme_versions where theme_id=theme)<>3 then raise exception 'failed release left partial snapshot'; end if;
end $$;
reset role;
do $$
declare result jsonb;
begin
 result := public.merge_store_theme_config(
   '{"pages":[{"id":"a"},{"id":"b"}]}',
   '{"pages":[{"id":"a"},{"id":"local","copy":"mine"},{"id":"b"}]}',
   '{"pages":[{"id":"a","title":"new"},{"id":"b"},{"id":"next"}]}');
 if result is distinct from '{"pages":[{"id":"a","title":"new"},{"id":"local","copy":"mine"},{"id":"b"},{"id":"next"}]}'::jsonb then
   raise exception 'keyed page merge lost inserted page or relative order: %',result;
 end if;
 begin
   perform public.merge_store_theme_config(
     '{"pages":[{"id":"a"},{"id":"b"},{"id":"c"}]}',
     '{"pages":[{"id":"b"},{"id":"a"},{"id":"c"}]}',
     '{"pages":[{"id":"a"},{"id":"c"},{"id":"b"}]}');
   raise exception 'conflicting reorder accepted';
 exception when sqlstate 'PT422' then null;
 end;
 begin
  update public.storefront_theme_versions set release_notes='Mutation' where version='1.0.0'
   and theme_id=(select id from public.storefront_template_catalog where theme_slug='version-fixture');
  raise exception 'snapshot update bypassed immutable trigger';
 exception when sqlstate '55000' then null;
 end;
end $$;
rollback;
