-- Disposable PostgreSQL after 202611250011. Fixtures roll back.
begin;
insert into auth.users(id,email,raw_app_meta_data) values
 ('9d000000-0000-4000-8000-000000000001','creation-admin@example.invalid','{"account_kind":"platform_admin"}'),
 ('9d000000-0000-4000-8000-000000000002','creation-owner@example.invalid','{}');
insert into public.platform_admins(user_id) values ('9d000000-0000-4000-8000-000000000001');
insert into auth.sessions(id,user_id,created_at,refreshed_at) values
 ('9d000000-0000-4000-8000-000000000011','9d000000-0000-4000-8000-000000000001',now(),now()),
 ('9d000000-0000-4000-8000-000000000012','9d000000-0000-4000-8000-000000000002',now(),now());
insert into public.business_categories(id,name,slug,merchandise_mode,theme_family) values
 ('9d000000-0000-4000-8000-000000000031','Creation General','creation-general','general','general'),
 ('9d000000-0000-4000-8000-000000000032','Creation Food','creation-food','food','food');
insert into public.stores(id,name,slug,created_by,status) values
 ('9d000000-0000-4000-8000-000000000021','Creation store','creation-theme-test','9d000000-0000-4000-8000-000000000002','active');
insert into public.store_members(store_id,user_id,role) values
 ('9d000000-0000-4000-8000-000000000021','9d000000-0000-4000-8000-000000000002','owner');
set local role authenticated;
do $$
declare
 admin_token constant text := '{"sub":"9d000000-0000-4000-8000-000000000001","session_id":"9d000000-0000-4000-8000-000000000011"}';
 owner_token constant text := '{"sub":"9d000000-0000-4000-8000-000000000002","session_id":"9d000000-0000-4000-8000-000000000012"}';
 category constant uuid := '9d000000-0000-4000-8000-000000000031';
 shop constant uuid := '9d000000-0000-4000-8000-000000000021';
 original uuid;
 starter uuid;
 cloned uuid;
 source_release uuid;
 purchase uuid;
 config jsonb;
 draft_config jsonb;
 report jsonb;
begin
 perform set_config('request.jwt.claims',admin_token,true);
 original := public.admin_create_theme_from_source('Creation original','creation-original','','9d000000-0000-4000-8000-000000000031','blank',null,null,null,null,null);
 select t.draft into config from public.storefront_template_catalog t where t.id=original;
 if not public.theme_manifest_valid(config) or config->>'schemaVersion'<>'2' or config#>>'{pages,0,kind}'<>'home'
  or config#>>'{settings,font}'<>'system' or not exists(select 1 from public.storefront_template_catalog where id=original
   and lifecycle='draft' and not is_enabled and created_by='9d000000-0000-4000-8000-000000000001') then raise exception 'blank theme missing data'; end if;
 begin
  perform public.admin_create_theme_from_source('Duplicate','creation-original','',category,'blank',null,null,null,null,null);
  raise exception 'duplicate slug accepted';
 exception when unique_violation then null;
 end;
 begin
  perform public.admin_create_theme_from_source('Missing category','creation-missing-category','','9d000000-0000-4000-8000-000000000099','blank',null,null,null,null,null);
  raise exception 'missing category accepted';
 exception when sqlstate 'PT404' then null;
 end;
 begin
  perform public.admin_create_theme_from_source('Bad thumbnail','creation-bad-thumbnail','',category,'blank',null,null,null,null,'http://example.invalid');
  raise exception 'invalid thumbnail accepted';
 exception when check_violation then null;
 end;
 if exists(select 1 from public.storefront_template_catalog where theme_slug='creation-bad-thumbnail') then
  raise exception 'failed metadata write left an orphan theme';
 end if;

 config := jsonb_set(config,'{pages,0,blocks}','[{"id":"81000000-0000-4000-8000-000000000002","kind":"announcement","title":"Release title","copy":"","limit":6,"hidden":false}]');
 config := jsonb_set(config,'{pages,1}','{"id":"81000000-0000-4000-8000-000000000003","kind":"contact","slug":"contact","title":"Liên hệ","description":"","visible":true,"blocks":[]}');
 perform public.admin_save_theme(original,0,'Creation original','creation-original','Published source','general','{}',50000,null,config);
 source_release := public.admin_publish_theme(original,1,'1.0.0');
 perform set_config('request.jwt.claims',owner_token,true);
 purchase := public.claim_store_theme(shop,original,source_release);
 perform set_config('request.jwt.claims',admin_token,true);
 perform public.admin_confirm_theme_transfer(purchase,50000,'CREATION-TEST-TRANSFER');
 perform set_config('request.jwt.claims',owner_token,true);
 perform public.activate_store_theme(shop,original);
 perform public.save_store_theme(shop,original,0,jsonb_set(config,'{headline}','"Merchant only"'),'draft');
 perform set_config('request.jwt.claims',admin_token,true);
 perform public.admin_autosave_theme(original,2,jsonb_set(config,'{pages,0,blocks,0,title}','"Draft title"'));
 report := public.admin_list_theme_creation_sources('starter','creation-original',0);
 if report#>>'{rows,0,version}' is distinct from '1.0.0' then raise exception 'published starter not listed'; end if;
 starter := public.admin_create_theme_from_source('Starter','creation-starter','',category,'starter',original,'1.0.0',null,null,null);
 cloned := public.admin_create_theme_from_source('Clone','creation-clone','',category,'clone',original,null,3,null,null);
 select t.draft into draft_config from public.storefront_template_catalog t where t.id=starter;
 if draft_config#>>'{pages,0,blocks,0,title}' is distinct from 'Release title'
  or draft_config#>>'{pages,0,id}'=config#>>'{pages,0,id}'
  or draft_config#>>'{pages,0,blocks,0,id}'=config#>>'{pages,0,blocks,0,id}'
  or draft_config#>>'{pages,1,slug}' is distinct from 'contact' then raise exception 'starter copy invalid'; end if;
 select t.draft into draft_config from public.storefront_template_catalog t where t.id=cloned;
 if draft_config#>>'{pages,0,blocks,0,title}' is distinct from 'Draft title' or draft_config->>'headline'='Merchant only'
  or draft_config->'settings' is distinct from config->'settings' or draft_config#>>'{pages,0,id}'=config#>>'{pages,0,id}'
  or exists(select 1 from public.storefront_theme_versions where theme_id in (starter,cloned))
  or exists(select 1 from public.storefront_theme_purchases where theme_id in (starter,cloned))
  or exists(select 1 from public.storefront_theme_licenses where theme_id in (starter,cloned))
  or exists(select 1 from public.storefront_store_theme where theme_id in (starter,cloned)) then raise exception 'clone copy invalid'; end if;
 perform public.admin_autosave_theme(cloned,0,jsonb_set(draft_config,'{headline}','"Clone change"'));
 if (select t.draft->>'headline' from public.storefront_template_catalog t where t.id=original)='Clone change' then raise exception 'clone affected source'; end if;
 begin
  perform public.admin_create_theme_from_source('Changed source','creation-stale','',category,'clone',original,null,2,null,null);
  raise exception 'stale draft accepted';
 exception when serialization_failure then null;
 end;
 begin
  perform public.admin_create_theme_from_source('Invalid family','creation-bad-family','','9d000000-0000-4000-8000-000000000032','starter',original,'1.0.0',null,null,null);
  raise exception 'incompatible source accepted';
 exception when sqlstate 'PT422' then null;
 end;
 perform set_config('request.jwt.claims',owner_token,true);
 begin
  perform public.admin_create_theme_from_source('Unauthorized','creation-denied','',category,'blank',null,null,null,null,null);
  raise exception 'merchant created theme';
 exception when insufficient_privilege then null;
 end;
 if exists(select 1 from public.storefront_template_catalog where id=cloned) then raise exception 'merchant read platform draft'; end if;
end $$;
rollback;
