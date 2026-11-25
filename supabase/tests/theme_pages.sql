-- Disposable database only, after 202611250003. No persistent fixtures.
begin;
do $$
declare
  legacy constant jsonb := '{"preset":"green","style":"modern","order":["hero","menu","reviews","story"],"hidden":[],"headline":"Test","density":"comfortable","settings":{"font":"system","radius":"soft","width":"standard","columns":[4,3,2]}}';
  page constant jsonb := '{"id":"81000000-0000-4000-8000-000000000001","kind":"custom","slug":"bao-hanh","title":"Bảo hành","description":"","visible":true,"blocks":[{"id":"81000000-0000-4000-8000-000000000002","kind":"announcement","title":"Thông báo","copy":"","limit":6,"hidden":false}]}';
  versioned jsonb := legacy || jsonb_build_object('schemaVersion',2,'pages',jsonb_build_array(page));
begin
 if not public.theme_manifest_valid(legacy) or not public.theme_manifest_valid(versioned) then
  raise exception 'legacy or v2 document was rejected';
 end if;
 if public.theme_manifest_valid(versioned || jsonb_build_object('pages',jsonb_build_array(page,page)))
  or public.theme_manifest_valid(jsonb_set(versioned,'{pages,0,blocks,0,kind}','"script"'))
  or public.theme_manifest_valid(jsonb_set(versioned,'{pages,0,slug}','"../checkout"')) then
  raise exception 'invalid structured document accepted';
 end if;
end $$;
rollback;
