-- Disposable database after 202611250009; rollback all changes.
begin;
insert into auth.users(id,email,raw_app_meta_data) values
 ('9b000000-0000-4000-8000-000000000001','component-admin@example.invalid','{"account_kind":"platform_admin"}'),
 ('9b000000-0000-4000-8000-000000000002','component-owner@example.invalid','{}');
insert into public.platform_admins(user_id) values ('9b000000-0000-4000-8000-000000000001');
insert into auth.sessions(id,user_id,created_at,refreshed_at) values
 ('9b000000-0000-4000-8000-000000000011','9b000000-0000-4000-8000-000000000001',now(),now()),
 ('9b000000-0000-4000-8000-000000000012','9b000000-0000-4000-8000-000000000002',now(),now());
insert into public.stores(id,name,slug,created_by,status) values
 ('9b000000-0000-4000-8000-000000000021','Component store','component-library-test','9b000000-0000-4000-8000-000000000002','active');
insert into public.store_members(store_id,user_id,role) values
 ('9b000000-0000-4000-8000-000000000021','9b000000-0000-4000-8000-000000000002','owner');
set local role authenticated;
do $$
declare
 admin_token constant text := '{"sub":"9b000000-0000-4000-8000-000000000001","session_id":"9b000000-0000-4000-8000-000000000011"}';
 owner_token constant text := '{"sub":"9b000000-0000-4000-8000-000000000002","session_id":"9b000000-0000-4000-8000-000000000012"}';
 shop constant uuid := '9b000000-0000-4000-8000-000000000021';
 original constant jsonb := '{"preset":"green","style":"modern","order":["hero","menu","reviews","story"],"hidden":[],"headline":"","density":"comfortable","settings":{"font":"system","radius":"soft","width":"standard","columns":[4,3,2]},"schemaVersion":2,"pages":[{"id":"81000000-0000-4000-8000-000000000001","kind":"custom","slug":"component-test","title":"Test","description":"","visible":true,"blocks":[{"id":"81000000-0000-4000-8000-000000000002","kind":"announcement","title":"Thông báo","copy":"","limit":6,"hidden":false}]}]}';
 edited jsonb := jsonb_set(original,'{pages,0,blocks,0,copy}','"Retained instance"');
 duplicate jsonb := jsonb_set(original,'{pages,0,blocks,1}',jsonb_set(original#>'{pages,0,blocks,0}','{id}','"81000000-0000-4000-8000-000000000003"'));
 incompatible jsonb := jsonb_set(original,'{pages,0,blocks,1}',
   jsonb_set(duplicate#>'{pages,0,blocks,1}','{kind}','"food_menu"'));
 theme uuid;
 release uuid;
 revision integer;
 before_usage jsonb;
 metrics jsonb;
begin
 perform set_config('request.jwt.claims',admin_token,true);
 perform public.admin_update_theme_policy(true,null,'{}');
 before_usage := public.admin_theme_component_usage('announcement',0);
 theme := public.admin_save_theme(null,0,'Component fixture','component-fixture','','general','{}',0,null,original);
 perform public.admin_publish_theme(theme,0,'1.0.0');
 perform public.admin_set_theme_component_status('announcement','disabled','active');
 if not (public.theme_component_availability()->'disabled' ? 'announcement') then raise exception 'status not saved'; end if;
 begin
  perform public.admin_set_theme_component_status('announcement','deprecated','active');
  raise exception 'stale state accepted';
 exception when serialization_failure then null;
 end;
 begin
  perform public.admin_autosave_theme(theme,1,duplicate);
  raise exception 'disabled instance accepted on platform';
 exception when sqlstate 'PT409' then null;
 end;
 begin
  perform public.admin_autosave_theme(theme,1,incompatible);
  raise exception 'industry incompatible instance accepted';
 exception when sqlstate 'PT409' then null;
 end;
 revision := public.admin_autosave_theme(theme,1,edited);
 if revision<>2 then raise exception 'retained instance could not be edited'; end if;
 release := public.admin_publish_theme(theme,2,'1.1.0');
 metrics := public.admin_theme_component_usage('announcement',0);
 if (metrics#>>'{summaries,announcement,themes}')::int - coalesce((before_usage#>>'{summaries,announcement,themes}')::int,0) <> 1
  or (metrics#>>'{summaries,announcement,pages}')::int - coalesce((before_usage#>>'{summaries,announcement,pages}')::int,0) <> 1
  or (metrics#>>'{summaries,announcement,releases}')::int - coalesce((before_usage#>>'{summaries,announcement,releases}')::int,0) <> 2
  or (metrics->>'count')::int - (before_usage->>'count')::int <> 3 then raise exception 'usage incorrectly aggregated'; end if;
 if (public.admin_theme_component_usage('announcement',(metrics->>'count')::int)->'references') is distinct from '[]'::jsonb then
  raise exception 'reference pagination did not apply';
 end if;
 perform public.admin_set_theme_component_status('announcement','deprecated','disabled');
 if not (public.theme_component_availability()->'deprecated' ? 'announcement') then raise exception 'deprecated state unavailable'; end if;
 begin
  perform public.admin_autosave_theme(theme,3,duplicate);
  raise exception 'deprecated instance accepted';
 exception when sqlstate 'PT409' then null;
 end;
 perform set_config('request.jwt.claims',owner_token,true);
 perform public.claim_store_theme(shop,theme,release);
 perform public.activate_store_theme(shop,theme);
 perform public.save_store_theme(shop,theme,0,edited,'draft');
 begin
  perform public.save_store_theme(shop,theme,1,duplicate,'draft');
  raise exception 'merchant added deprecated component';
 exception when sqlstate 'PT409' then null;
 end;
 if public.get_public_store_theme(shop) is distinct from edited then raise exception 'deprecated component broke storefront snapshot'; end if;
 begin
  perform public.admin_set_theme_component_status('announcement','active','deprecated');
  raise exception 'merchant changed registry policy';
 exception when insufficient_privilege then null;
 end;
 begin
  perform public.admin_theme_component_usage('announcement',0);
  raise exception 'merchant accessed platform usage';
 exception when insufficient_privilege then null;
 end;
end $$;
rollback;
