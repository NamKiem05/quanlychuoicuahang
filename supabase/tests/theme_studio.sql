-- Disposable database only. Uses simulated bank confirmation and rolls every fixture back.
begin;
insert into auth.users(id,email,raw_app_meta_data) values
 ('81000000-0000-4000-8000-000000000001','theme-admin@example.invalid','{"account_kind":"platform_admin"}'),
 ('81000000-0000-4000-8000-000000000002','theme-owner@example.invalid','{}'),
 ('81000000-0000-4000-8000-000000000003','theme-other@example.invalid','{}');
insert into public.platform_admins(user_id) values ('81000000-0000-4000-8000-000000000001');
insert into auth.sessions(id,user_id,created_at,refreshed_at) values
 ('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',now(),now()),
 ('82000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000002',now(),now());
insert into public.stores(id,name,slug,created_by,status) values
 ('83000000-0000-4000-8000-000000000002','Theme test shop','theme-test-shop','81000000-0000-4000-8000-000000000002','active'),
 ('83000000-0000-4000-8000-000000000003','Theme other shop','theme-other-shop','81000000-0000-4000-8000-000000000003','active');
insert into public.store_members(store_id,user_id,role) values
 ('83000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000002','owner'),
 ('83000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000003','owner');

set local role authenticated;
do $$
declare
 admin_claims constant text := '{"sub":"81000000-0000-4000-8000-000000000001","session_id":"82000000-0000-4000-8000-000000000001"}';
 owner_claims constant text := '{"sub":"81000000-0000-4000-8000-000000000002","session_id":"82000000-0000-4000-8000-000000000002"}';
 shop constant uuid := '83000000-0000-4000-8000-000000000002';
 other_shop constant uuid := '83000000-0000-4000-8000-000000000003';
 initial constant jsonb := '{"preset":"green","style":"modern","order":["hero","menu","reviews","story"],"hidden":[],"headline":"Theme test","density":"comfortable","settings":{"font":"system","radius":"soft","width":"standard","columns":[4,3,2]}}';
 edited jsonb := jsonb_set(initial,'{headline}','"Override test"');
 theme uuid;
 first_release uuid;
 second_release uuid;
 payment uuid;
begin
 perform set_config('request.jwt.claims',admin_claims,true);
 theme := public.admin_save_theme(null,0,'Test theme','theme-test-flow','', 'general','{}',49000,null,initial);
 perform set_config('request.jwt.claims',owner_claims,true);
 if exists(select 1 from public.list_store_themes(shop) t where t.id=theme) then raise exception 'draft leaked'; end if;
 begin
   perform public.list_store_themes(other_shop);
   raise exception 'cross-tenant marketplace read accepted';
 exception when insufficient_privilege then null;
 end;
 perform set_config('request.jwt.claims',admin_claims,true);
 first_release := public.admin_publish_theme(theme,0,'1.0.0');
 perform set_config('request.jwt.claims',owner_claims,true);
 payment := public.claim_store_theme(shop,theme,first_release);
 if payment is null or payment is distinct from public.claim_store_theme(shop,theme,first_release) then raise exception 'purchase not idempotent'; end if;
 begin
   perform public.activate_store_theme(shop,theme);
   raise exception 'unpaid theme was activated';
 exception when insufficient_privilege then null;
 end;
 perform set_config('request.jwt.claims',admin_claims,true);
 begin
   perform public.admin_confirm_theme_transfer(payment,48999,'THEME-TEST-001');
   raise exception 'incorrect payment amount accepted';
 exception when sqlstate '22023' then null;
 end;
 perform public.admin_confirm_theme_transfer(payment,49000,'THEME-TEST-001');
 perform public.admin_confirm_theme_transfer(payment,49000,'theme-test-001');
 second_release := public.admin_publish_theme(theme,1,'1.0.1');
 perform public.admin_archive_theme(theme);
 perform set_config('request.jwt.claims',owner_claims,true);
 perform public.activate_store_theme(shop,theme);
 if public.get_public_store_theme(shop) is distinct from initial then raise exception 'archived license stopped working'; end if;
 perform public.save_store_theme(shop,theme,0,edited,'draft');
 if public.get_public_store_theme(shop) is distinct from initial then raise exception 'draft leaked publicly'; end if;
 perform public.save_store_theme(shop,theme,1,null,'publish');
 perform public.select_store_theme_version(shop,theme,second_release,2);
 perform public.select_store_theme_version(shop,theme,first_release,3);
 if public.get_public_store_theme(shop) is distinct from edited or public.get_public_store_theme(other_shop) is not null then
   raise exception 'store version rollback lost its overrides or crossed tenants';
 end if;
 perform set_config('request.jwt.claims',admin_claims,true);
 perform public.admin_revoke_theme_license(shop,theme,'Quy trình kiểm thử');
 if public.get_public_store_theme(shop) is not null then raise exception 'revoked theme is still active publicly'; end if;
end;
$$;
rollback;
