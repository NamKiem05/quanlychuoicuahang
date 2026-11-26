begin;

-- Extend v2 with optional page metadata while keeping legacy manifests readable.
create or replace function public.theme_manifest_valid(value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
 page jsonb; block jsonb; meta jsonb; field record; homepage boolean := false;
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
  if (select count(*) from jsonb_object_keys(page)) <> (case when page ? 'meta' then 8 else 7 end)
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
  if page ? 'meta' then
   meta := page->'meta';
   if jsonb_typeof(meta) <> 'object' then return false; end if;
   for field in select * from jsonb_each(meta) loop
    if not (case field.key
     when 'template' then page->>'kind'='custom' and jsonb_typeof(field.value)='string'
       and field.value#>>'{}' in ('content','contact','faq','policy')
     when 'homepage' then jsonb_typeof(field.value)='boolean' and
       (field.value='false'::jsonb or (not homepage and page->'visible'='true'::jsonb
         and page->>'kind' in ('home','custom','about','contact')))
     when 'navigation' then jsonb_typeof(field.value)='boolean'
     when 'noindex' then jsonb_typeof(field.value)='boolean'
     when 'seoTitle' then jsonb_typeof(field.value)='string' and char_length(field.value#>>'{}')<=100
     when 'ogTitle' then jsonb_typeof(field.value)='string' and char_length(field.value#>>'{}')<=100
     when 'seoDescription' then jsonb_typeof(field.value)='string' and char_length(field.value#>>'{}')<=240
     when 'ogDescription' then jsonb_typeof(field.value)='string' and char_length(field.value#>>'{}')<=240
     when 'createdAt' then jsonb_typeof(field.value)='string' and field.value#>>'{}' ~ '^[0-9]{4}(-[0-9]{2}){2}T[0-9]{2}(:[0-9]{2}){2}[.][0-9]{3}Z$'
     when 'updatedAt' then jsonb_typeof(field.value)='string' and field.value#>>'{}' ~ '^[0-9]{4}(-[0-9]{2}){2}T[0-9]{2}(:[0-9]{2}){2}[.][0-9]{3}Z$'
     when 'ogImage' then jsonb_typeof(field.value)='string' and char_length(field.value#>>'{}')<=2048
       and field.value#>>'{}' ~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?([/?#]|$)'
       and field.value#>>'{}' !~ '[[:space:]]' and strpos(field.value#>>'{}',chr(92))=0
     else false end) then return false; end if;
   end loop;
   if meta->'homepage'='true'::jsonb then homepage := true; end if;
  end if;
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
