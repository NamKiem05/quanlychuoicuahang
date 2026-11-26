-- Disposable Supabase/PostgreSQL only, after 202611250006. Roll back all fixtures.
begin;
insert into auth.users(id,email,raw_app_meta_data) values
 ('98000000-0000-4000-8000-000000000001','library-admin@example.invalid','{"account_kind":"platform_admin"}'),
 ('98000000-0000-4000-8000-000000000002','library-owner@example.invalid','{}');
insert into public.platform_admins(user_id) values ('98000000-0000-4000-8000-000000000001');
insert into auth.sessions(id,user_id,created_at,refreshed_at) values
 ('98000000-0000-4000-8000-000000000011','98000000-0000-4000-8000-000000000001',now(),now()),
 ('98000000-0000-4000-8000-000000000012','98000000-0000-4000-8000-000000000002',now(),now());
update public.profiles set display_name='Library Developer' where id='98000000-0000-4000-8000-000000000001';
insert into public.profiles(id,display_name) values ('98000000-0000-4000-8000-000000000001','Library Developer') on conflict(id) do nothing;
insert into public.stores(id,name,slug,created_by,status) values
 ('98000000-0000-4000-8000-000000000021','Library test store','theme-library-test-store','98000000-0000-4000-8000-000000000002','active');
insert into public.store_members(store_id,user_id,role) values
 ('98000000-0000-4000-8000-000000000021','98000000-0000-4000-8000-000000000002','owner');

set local role authenticated;
do $$
declare
  admin_token constant text := '{"sub":"98000000-0000-4000-8000-000000000001","session_id":"98000000-0000-4000-8000-000000000011"}';
  owner_token constant text := '{"sub":"98000000-0000-4000-8000-000000000002","session_id":"98000000-0000-4000-8000-000000000012"}';
  admin_user constant uuid := '98000000-0000-4000-8000-000000000001';
  shop constant uuid := '98000000-0000-4000-8000-000000000021';
  config constant jsonb := '{"preset":"green","style":"modern","order":["hero","menu","reviews","story"],"hidden":[],"headline":"Library","density":"comfortable","settings":{"font":"system","radius":"soft","width":"standard","columns":[4,3,2]},"schemaVersion":2,"pages":[{"id":"81000000-0000-4000-8000-000000000001","kind":"custom","slug":"bao-hanh","title":"Bảo hành","description":"","visible":true,"blocks":[{"id":"81000000-0000-4000-8000-000000000002","kind":"announcement","title":"Thông báo","copy":"Nội dung","limit":6,"hidden":false}]}]}';
  draft uuid;
  duplicate uuid;
  release uuid;
  purchase uuid;
  detail jsonb;
  result jsonb;
  store_config jsonb := jsonb_set(config,'{headline}','"Riêng cửa hàng"');
  date_in_vietnam date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  target text;
begin
  perform set_config('request.jwt.claims',admin_token,true);
  perform public.admin_update_theme_policy(true,null,'{}');
  draft := public.admin_save_theme_library(null,null,0,'Library Fixture Original','fixture-library-original','Description','general','Featured',
    'https://example.invalid/preview.jpg','https://example.invalid/thumb.jpg',config);
  detail := public.admin_get_theme_library(draft);
  if detail->>'lifecycle' is distinct from 'draft' or detail->>'distribution' is distinct from 'unlisted'
    or detail->>'created_by' is distinct from admin_user::text or detail->'draft' is distinct from config
    or detail->>'licenses' is distinct from '0' or detail->>'installations' is distinct from '0'
    or detail->>'thumbnail_url' is distinct from 'https://example.invalid/thumb.jpg' then raise exception 'draft metadata defaults incorrect'; end if;
  foreach target in array array['Fixture Original','fixture-library-original',draft::text,'Library Developer'] loop
    result := public.admin_list_theme_library(target,'draft','unlisted','general','Featured',admin_user,
      'created',date_in_vietnam,date_in_vietnam,'name_asc',0);
    if result->>'count' is distinct from '1' or result#>>'{rows,0,id}' is distinct from draft::text then
      raise exception 'combined filter failed: %', target;
    end if;
  end loop;
  result := public.admin_list_theme_library('fixture-library-original','draft','hidden',null,null,null,'created',null,null,'newest',0);
  if result->>'count' is distinct from '0' or result->'rows' is distinct from '[]'::jsonb then raise exception 'empty filter result incorrect'; end if;
  begin
    perform public.admin_save_theme_library(null,null,0,'Duplicate slug','fixture-library-original','','general','',null,null,config);
    raise exception 'duplicate slug accepted';
  exception when unique_violation then null;
  end;
  begin
    perform public.admin_save_theme_library(null,null,0,'Invalid image','fixture-library-invalid','','general','',null,'http://example.invalid',config);
    raise exception 'insecure image accepted';
  exception when invalid_parameter_value then null;
  end;

  perform public.admin_save_theme(draft,0,'Library Fixture Original','fixture-library-original','Description','general','{}',95000,
    'https://example.invalid/preview.jpg',config);
  release := public.admin_publish_theme(draft,1,'1.0.0');
  perform set_config('request.jwt.claims',owner_token,true);
  purchase := public.claim_store_theme(shop,draft,release);
  perform set_config('request.jwt.claims',admin_token,true);
  perform public.admin_confirm_theme_transfer(purchase,95000,'THEME-LIBRARY-TEST');
  perform set_config('request.jwt.claims',owner_token,true);
  perform public.activate_store_theme(shop,draft);
  perform public.save_store_theme(shop,draft,0,store_config,'draft');
  perform public.save_store_theme(shop,draft,1,null,'publish');
  perform set_config('request.jwt.claims',admin_token,true);
  perform public.admin_save_theme_library(draft,null,2,'Library Fixture Updated','fixture-library-original','Changed','general','Updated',
    'https://example.invalid/new-preview.jpg',null,null);
  detail := public.admin_get_theme_library(draft);
  if detail->>'name' is distinct from 'Library Fixture Updated' or detail->>'version' is distinct from '1.0.0'
    or detail->>'published_price' is distinct from '95000'
    or detail->>'published_preview' is distinct from 'https://example.invalid/preview.jpg'
    or detail->'published_manifest' is distinct from config or detail->'draft' is distinct from config
    or detail->>'active_stores' is distinct from '1' or detail->>'licenses' is distinct from '1'
    or detail->>'distribution' is distinct from 'listed' or detail->>'orders' is distinct from '1'
    or public.get_public_store_theme(shop) is distinct from store_config then raise exception 'metadata edit changed published or dependent data'; end if;
  if not exists(select 1 from public.admin_theme_marketplace_view where id=draft and name='Library Fixture Original' and price_vnd=95000) then
    raise exception 'edit changed marketplace release snapshot';
  end if;
  begin
    perform public.admin_save_theme_library(draft,null,2,'Stale edit','fixture-library-original','','general','',null,null,null);
    raise exception 'stale edit accepted';
  exception when serialization_failure then null;
  end;

  duplicate := public.admin_save_theme_library(null,draft,3,'Library Fixture Copy','fixture-library-copy','Copy','general','Featured',null,null,null);
  detail := public.admin_get_theme_library(duplicate);
  if duplicate=draft or detail->'draft' is distinct from config or detail->>'lifecycle' is distinct from 'draft'
    or detail->>'distribution' is distinct from 'unlisted' or detail->>'has_release' is distinct from 'false'
    or detail->>'installations' is distinct from '0' or detail->>'licenses' is distinct from '0' or detail->>'orders' is distinct from '0'
    then raise exception 'copy failed to isolate relations or retain manifest'; end if;

  for page_item in 1..21 loop
    perform public.admin_save_theme_library(null,null,0,'Pagination fixture '||lpad(page_item::text,2,'0'),
      'fixture-library-page-'||page_item,'','general','Page fixtures',null,null,config);
  end loop;
  result := public.admin_list_theme_library(null,null,null,null,'Page fixtures',null,'created',null,null,'name_asc',0);
  if result->>'count' is distinct from '21' or jsonb_array_length(result->'rows')<>20
    or result#>>'{rows,0,name}' is distinct from 'Pagination fixture 01' then raise exception 'first page incorrect'; end if;
  result := public.admin_list_theme_library(null,null,null,null,'Page fixtures',null,'created',null,null,'name_asc',20);
  if jsonb_array_length(result->'rows')<>1 or result#>>'{rows,0,name}' is distinct from 'Pagination fixture 21' then
    raise exception 'second page incorrect';
  end if;
  result := public.admin_list_theme_library('Library Fixture',null,null,null,null,null,'updated',date_in_vietnam,date_in_vietnam,'stores',0);
  if result#>>'{rows,0,id}' is distinct from draft::text then raise exception 'store sort incorrect'; end if;
  result := public.admin_list_theme_library('Library Fixture',null,null,null,null,null,'updated',null,null,'installations',0);
  if result#>>'{rows,0,id}' is distinct from draft::text then raise exception 'installation sort incorrect'; end if;

  begin
    perform public.admin_change_theme_library(draft,3,true,'delete');
    raise exception 'theme with dependent records was deleted';
  exception when foreign_key_violation then null;
  end;
  perform public.admin_change_theme_library(draft,3,true,'hide');
  detail := public.admin_get_theme_library(draft);
  if detail->>'lifecycle' is distinct from 'published' or detail->>'distribution' is distinct from 'hidden' then
    raise exception 'visibility changed lifecycle';
  end if;
  begin
    perform public.admin_change_theme_library(draft,3,true,'show');
    raise exception 'stale visibility accepted';
  exception when serialization_failure then null;
  end;
  perform public.admin_change_theme_library(draft,3,false,'show');
  perform public.admin_update_theme_policy(false,null,'{}');
  detail := public.admin_get_theme_library(draft);
  if detail->>'distribution' is distinct from 'paused' then raise exception 'global closure not reflected'; end if;
  perform public.admin_change_theme_library(draft,3,true,'archive');
  detail := public.admin_get_theme_library(draft);
  if detail->>'lifecycle' is distinct from 'archived' or detail->>'licenses' is distinct from '1'
    or detail->>'orders' is distinct from '1' or public.get_public_store_theme(shop) is distinct from store_config then
    raise exception 'archive broke license, order or storefront';
  end if;
  perform public.admin_change_theme_library(duplicate,0,false,'delete');
  if public.admin_get_theme_library(duplicate) is not null then raise exception 'unused draft was not deleted'; end if;

  perform set_config('request.jwt.claims',owner_token,true);
  begin
    perform public.admin_list_theme_library(null,null,null,null,null,null,'created',null,null,'newest',0);
    raise exception 'merchant read admin library';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_get_theme_library(draft);
    raise exception 'merchant read admin theme detail';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_save_theme_library(draft,null,4,'Merchant edit','fixture-library-original','','general','',null,null,null);
    raise exception 'merchant edited metadata';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_change_theme_library(draft,4,false,'archive');
    raise exception 'merchant changed lifecycle';
  exception when insufficient_privilege then null;
  end;
  if has_table_privilege('authenticated','public.admin_theme_library_rows','select')
    or has_function_privilege('anon','public.admin_get_theme_library(uuid)','execute') then
    raise exception 'library data exposed outside protected RPC';
  end if;
end $$;
rollback;
