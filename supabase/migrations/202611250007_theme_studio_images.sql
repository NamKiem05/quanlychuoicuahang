begin;

-- Keep v1/v2 documents valid and allow platform image object keys on announcement blocks.
create or replace function public.theme_manifest_valid(value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
 page jsonb; block jsonb;
 ids text[] := '{}'; slugs text[] := '{}';
 kinds constant text[] := array['home','products','product','category','search','cart','contact','about','custom'];
 uid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
 if not (value ? 'schemaVersion') then return public.theme_manifest_v1_valid(value); end if;
 if value->'schemaVersion' is distinct from '2'::jsonb
   or not public.theme_manifest_v1_valid(value - 'schemaVersion' - 'pages')
   or jsonb_typeof(value->'pages') is distinct from 'array' then return false; end if;
 if jsonb_array_length(value->'pages') > 16 then return false; end if;
 for page in select jsonb_array_elements(value->'pages') loop
  if jsonb_typeof(page) is distinct from 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(page)) <> 7
   or not (page ?& array['id','kind','slug','title','description','visible','blocks'])
   or coalesce(page->>'id','') !~* uid or lower(page->>'id')=any(ids)
   or not coalesce((page->>'kind')=any(kinds),false)
   or coalesce(page->>'slug','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
   or char_length(page->>'slug')>64 or (page->>'slug')=any(slugs)
   or (case when page->>'kind'='custom' then (page->>'slug')=any(kinds) else page->>'slug'<>page->>'kind' end)
   or jsonb_typeof(page->'title') is distinct from 'string' or char_length(page->>'title')>100
   or jsonb_typeof(page->'description') is distinct from 'string' or char_length(page->>'description')>240
   or jsonb_typeof(page->'visible') is distinct from 'boolean'
   or (page->>'kind'<>'custom' and page->'visible'='false'::jsonb)
   or jsonb_typeof(page->'blocks') is distinct from 'array' then return false; end if;
  if jsonb_array_length(page->'blocks')>16 then return false; end if;
  ids:=array_append(ids,lower(page->>'id')); slugs:=array_append(slugs,page->>'slug');
  for block in select jsonb_array_elements(page->'blocks') loop
   if jsonb_typeof(block) is distinct from 'object' then return false; end if;
   if (select count(*) from jsonb_object_keys(block)) <> (case when block ? 'image' then 7 else 6 end)
    or not (block ?& array['id','kind','title','copy','limit','hidden'])
    or coalesce(block->>'id','') !~* uid or lower(block->>'id')=any(ids)
    or not coalesce(block->>'kind' in ('announcement','story','contact','testimonials','categories','new_arrivals','food_menu','fashion_collection','beauty_collection','electronics_collection','home_collection'),false)
    or jsonb_typeof(block->'title') is distinct from 'string' or char_length(block->>'title')>100
    or jsonb_typeof(block->'copy') is distinct from 'string' or char_length(block->>'copy')>500
    or jsonb_typeof(block->'limit') is distinct from 'number' or coalesce(block->>'limit','') !~ '^([1-9]|1[0-2])$'
    or jsonb_typeof(block->'hidden') is distinct from 'boolean'
    or (block ? 'image' and (block->>'kind'<>'announcement'
      or jsonb_typeof(block->'image') is distinct from 'string'
      or block->>'image' !~ '^theme-studio/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}[.](png|jpg|webp)$'))
    then return false; end if;
   ids:=array_append(ids,lower(block->>'id'));
  end loop;
 end loop;
 return true;
end;
$$;

commit;
