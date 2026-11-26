-- Disposable database after 202611250007. All records roll back.
begin;
insert into auth.users(id,email,raw_app_meta_data) values
 ('99000000-0000-4000-8000-000000000001','studio-admin@example.invalid','{"account_kind":"platform_admin"}'),
 ('99000000-0000-4000-8000-000000000002','studio-owner@example.invalid','{}');
insert into public.platform_admins(user_id) values ('99000000-0000-4000-8000-000000000001');
insert into auth.sessions(id,user_id,created_at,refreshed_at) values
 ('99000000-0000-4000-8000-000000000011','99000000-0000-4000-8000-000000000001',now(),now()),
 ('99000000-0000-4000-8000-000000000012','99000000-0000-4000-8000-000000000002',now(),now());
insert into public.stores(id,name,slug,created_by,status) values
 ('99000000-0000-4000-8000-000000000021','Studio store','theme-studio-editor-test','99000000-0000-4000-8000-000000000002','active');
insert into public.store_members(store_id,user_id,role) values
 ('99000000-0000-4000-8000-000000000021','99000000-0000-4000-8000-000000000002','owner');
set local role authenticated;
do $$
declare
 admin_token constant text := '{"sub":"99000000-0000-4000-8000-000000000001","session_id":"99000000-0000-4000-8000-000000000011"}';
 owner_token constant text := '{"sub":"99000000-0000-4000-8000-000000000002","session_id":"99000000-0000-4000-8000-000000000012"}';
 shop constant uuid := '99000000-0000-4000-8000-000000000021';
 original constant jsonb := '{"preset":"green","style":"modern","order":["hero","menu","reviews","story"],"hidden":[],"headline":"Original","density":"comfortable","settings":{"font":"system","radius":"soft","width":"standard","columns":[4,3,2]},"schemaVersion":2,"pages":[{"id":"81000000-0000-4000-8000-000000000001","kind":"custom","slug":"studio","title":"Studio","description":"","visible":true,"blocks":[{"id":"81000000-0000-4000-8000-000000000002","kind":"announcement","title":"Thông báo","copy":"Nội dung","limit":6,"hidden":false}]}]}';
 custom jsonb := jsonb_set(original,'{headline}','"Merchant"');
 edited jsonb := jsonb_set(original,'{pages,0,blocks,0,image}','"theme-studio/81000000-0000-4000-8000-000000000001/81000000-0000-4000-8000-000000000002.webp"');
 theme uuid;
 release uuid;
begin
 perform set_config('request.jwt.claims',admin_token,true);
 perform public.admin_update_theme_policy(true,null,'{}');
 theme := public.admin_save_theme(null,0,'Studio editor','studio-editor-test','','general','{}',0,null,original);
 release := public.admin_publish_theme(theme,0,'1.0.0');
 perform set_config('request.jwt.claims',owner_token,true);
 perform public.claim_store_theme(shop,theme,release);
 perform public.activate_store_theme(shop,theme);
 perform public.save_store_theme(shop,theme,0,custom,'draft');
 perform public.save_store_theme(shop,theme,1,null,'publish');
 begin
  perform public.admin_autosave_theme(theme,1,edited);
  raise exception 'merchant can edit platform draft';
 exception when insufficient_privilege then null;
 end;
 perform set_config('request.jwt.claims',admin_token,true);
 if public.admin_autosave_theme(theme,1,edited) is distinct from 2 then raise exception 'draft revision did not advance'; end if;
 begin
  perform public.admin_autosave_theme(theme,1,original);
  raise exception 'stale draft request overwrote new revision';
 exception when serialization_failure then null;
 end;
 begin
  perform public.admin_autosave_theme(theme,2,jsonb_set(edited,'{pages,0,blocks,0,image}','"https://other-shop.invalid/image.png"'));
  raise exception 'foreign image URL accepted';
 exception when invalid_parameter_value then null;
 end;
 if (select draft from public.storefront_template_catalog where id=theme) is distinct from edited
  or (select manifest from public.storefront_theme_versions where id=release) is distinct from original
  or public.get_public_store_theme(shop) is distinct from custom then
  raise exception 'autosave affected a published snapshot or the store configuration';
 end if;
end $$;
rollback;
