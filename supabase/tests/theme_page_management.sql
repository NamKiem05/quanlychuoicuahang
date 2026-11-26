-- Disposable database only, after 202611250008.
begin;
insert into auth.users(id,email,raw_app_meta_data) values
 ('9a000000-0000-4000-8000-000000000001','page-admin@example.invalid','{"account_kind":"platform_admin"}');
insert into public.platform_admins(user_id) values ('9a000000-0000-4000-8000-000000000001');
insert into auth.sessions(id,user_id,created_at,refreshed_at) values
 ('9a000000-0000-4000-8000-000000000011','9a000000-0000-4000-8000-000000000001',now(),now());
set local role authenticated;
do $$
declare
 legacy constant jsonb := '{"preset":"green","style":"modern","order":["hero","menu","reviews","story"],"hidden":[],"headline":"","density":"comfortable","settings":{"font":"system","radius":"soft","width":"standard","columns":[4,3,2]}}';
 home constant jsonb := '{"id":"81000000-0000-4000-8000-000000000001","kind":"home","slug":"home","title":"Trang chủ","description":"","visible":true,"blocks":[]}';
 content constant jsonb := '{"id":"81000000-0000-4000-8000-000000000002","kind":"custom","slug":"chinh-sach","title":"Chính sách","description":"","visible":true,"blocks":[]}';
 before_release jsonb := legacy || jsonb_build_object('schemaVersion',2,'pages',jsonb_build_array(home,content));
 draft jsonb := jsonb_set(before_release,'{pages,1,meta}',
   '{"template":"policy","navigation":false,"homepage":true,"seoTitle":"Chính sách SEO","ogImage":"https://example.invalid/image.webp","noindex":true,"updatedAt":"2026-11-25T10:15:00.000Z"}');
 theme uuid;
 release uuid;
 revision integer;
begin
 perform set_config('request.jwt.claims','{"sub":"9a000000-0000-4000-8000-000000000001","session_id":"9a000000-0000-4000-8000-000000000011"}',true);
 if not public.theme_manifest_valid(legacy) or not public.theme_manifest_valid(before_release) or not public.theme_manifest_valid(draft) then
  raise exception 'compatible or extended manifest rejected';
 end if;
 if public.theme_manifest_valid(jsonb_set(draft,'{pages,0,meta}','{"homepage":true}'))
  or public.theme_manifest_valid(jsonb_set(draft,'{pages,1,visible}','false'))
  or public.theme_manifest_valid(jsonb_set(draft,'{pages,0,meta}','{"template":"policy"}'))
  or public.theme_manifest_valid(jsonb_set(draft,'{pages,1,meta,ogImage}','"https://user@example.invalid/img"'))
  or public.theme_manifest_valid(jsonb_set(draft,'{pages,1,meta,seoTitle}',to_jsonb(repeat('x',101))))
  or public.theme_manifest_valid(jsonb_set(draft,'{pages,1,meta,canonical}','"https://example.invalid"',true)) then
  raise exception 'invalid metadata accepted';
 end if;
 theme := public.admin_save_theme(null,0,'Page test','page-management-test','','general','{}',0,null,before_release);
 release := public.admin_publish_theme(theme,0,'1.0.0');
 revision := public.admin_autosave_theme(theme,1,draft);
 if revision is distinct from 2
  or (select t.draft from public.storefront_template_catalog t where t.id=theme) is distinct from draft
  or (select manifest from public.storefront_theme_versions where id=release) is distinct from before_release then
  raise exception 'saving page metadata altered release or failed to persist';
 end if;
 begin
  perform public.admin_autosave_theme(theme,1,before_release);
  raise exception 'stale Page Management draft overwrote newer revision';
 exception when serialization_failure then null;
 end;
end $$;
rollback;
