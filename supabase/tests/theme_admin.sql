-- Disposable PostgreSQL only, after 202611250004. Roll back all fixtures.
begin;
insert into auth.users(id,email,raw_app_meta_data) values
 ('91000000-0000-4000-8000-000000000001','theme-test-admin@example.invalid','{"account_kind":"platform_admin"}'),
 ('91000000-0000-4000-8000-000000000002','theme-test-owner@example.invalid','{}');
insert into public.platform_admins(user_id) values ('91000000-0000-4000-8000-000000000001');
insert into auth.sessions(id,user_id,created_at,refreshed_at) values
 ('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001',now(),now()),
 ('92000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000002',now(),now());
insert into public.stores(id,name,slug,created_by,status) values
 ('93000000-0000-4000-8000-000000000001','Theme management test','theme-management-flow','91000000-0000-4000-8000-000000000002','active');
insert into public.store_members(store_id,user_id,role) values
 ('93000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','owner');
set local role authenticated;
do $$
declare
 admin_token constant text := '{"sub":"91000000-0000-4000-8000-000000000001","session_id":"92000000-0000-4000-8000-000000000001"}';
 owner_token constant text := '{"sub":"91000000-0000-4000-8000-000000000002","session_id":"92000000-0000-4000-8000-000000000002"}';
 shop constant uuid := '93000000-0000-4000-8000-000000000001';
 base constant jsonb := '{"preset":"green","style":"modern","order":["hero","menu","reviews","story"],"hidden":[],"headline":"Test","density":"comfortable","settings":{"font":"system","radius":"soft","width":"standard","columns":[4,3,2]}}';
 theme uuid;
 unpublished uuid;
 release uuid;
begin
 perform set_config('request.jwt.claims',admin_token,true);
 theme := public.admin_save_theme(null,0,'Free test','theme-admin-free','', 'general','{}',0,null,base);
 unpublished := public.admin_save_theme(null,0,'Draft test','theme-admin-draft','','general','{}',0,null,base);
 perform public.admin_delete_unreleased_theme(unpublished);
 release := public.admin_publish_theme(theme,0,'1.0.0');
 perform public.admin_theme_visibility(theme,false);
 perform set_config('request.jwt.claims',owner_token,true);
 if exists(select 1 from public.list_store_themes(shop) t where t.id=theme) then raise exception 'hidden theme published in marketplace'; end if;
 begin
  perform public.admin_update_theme_policy(false,0,'{}');
  raise exception 'owner modified theme settings';
 exception when insufficient_privilege then null;
 end;
 perform set_config('request.jwt.claims',admin_token,true);
 perform public.admin_grant_free_theme(shop,theme,'Mẫu thử nghiệm');
 perform public.admin_grant_free_theme(shop,theme,'Mẫu thử nghiệm');
 perform public.admin_update_theme_policy(false,null,'{}');
 perform set_config('request.jwt.claims',owner_token,true);
 perform public.activate_store_theme(shop,theme);
 if public.get_public_store_theme(shop) is distinct from base then raise exception 'hidden or closed marketplace invalidated existing license'; end if;
 perform set_config('request.jwt.claims',admin_token,true);
 if not exists(select 1 from public.admin_theme_version_usage(theme) u where u.id=release and u.count=1) then raise exception 'usage report did not include active license'; end if;
 if public.admin_restore_theme_version(theme,release,1) is distinct from 2 then raise exception 'restore did not advance draft revision'; end if;
 begin
  perform public.admin_delete_unreleased_theme(theme);
  raise exception 'published theme was deleted';
 exception when sqlstate '22023' then null;
 end;
end $$;
rollback;
