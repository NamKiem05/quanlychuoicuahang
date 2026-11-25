begin;
create function public.theme_manifest_v1_valid(value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare keys_count integer; options jsonb; grid jsonb;
begin
  if jsonb_typeof(value) is distinct from 'object' then return false; end if;
  select count(*) into keys_count from jsonb_object_keys(value);
  if keys_count <> 7 or not (value ?& array['preset','style','order','hidden','headline','density','settings'])
    or jsonb_typeof(value->'order') is distinct from 'array'
    or jsonb_typeof(value->'hidden') is distinct from 'array' then return false; end if;
  options := value->'settings';
  if jsonb_typeof(options) is distinct from 'object' then return false; end if;
  select count(*) into keys_count from jsonb_object_keys(options);
  grid := options->'columns';
  if keys_count <> 4 or not (options ?& array['font','radius','width','columns'])
    or jsonb_typeof(grid) is distinct from 'array' then return false; end if;
  if jsonb_array_length(grid) <> 3 or not (
    grid->0 in ('1'::jsonb,'2'::jsonb,'3'::jsonb,'4'::jsonb,'5'::jsonb,'6'::jsonb)
    and grid->1 in ('1'::jsonb,'2'::jsonb,'3'::jsonb,'4'::jsonb)
    and grid->2 in ('1'::jsonb,'2'::jsonb)) then return false; end if;
  return coalesce(value->>'preset' in ('green','orange','blue','rose')
    and value->>'style' in ('original','modern','cozy','minimal')
    and value->>'density' in ('compact','comfortable')
    and options->>'font' in ('system','serif')
    and options->>'radius' in ('soft','square')
    and options->>'width' in ('standard','wide')
    and jsonb_typeof(value->'headline') = 'string' and char_length(value->>'headline') <= 100
    and jsonb_array_length(value->'order')=4
    and value->'order' @> '["hero","menu","reviews","story"]'::jsonb
    and value->'hidden' <@ '["hero","reviews","story"]'::jsonb
    and jsonb_array_length(value->'hidden') = (select count(distinct j) from jsonb_array_elements(value->'hidden') j), false);
end;
$$;

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
   if (select count(*) from jsonb_object_keys(block)) <> 6
    or not (block ?& array['id','kind','title','copy','limit','hidden'])
    or coalesce(block->>'id','') !~* uid or lower(block->>'id')=any(ids)
    or not coalesce(block->>'kind' in ('announcement','story','contact','testimonials','categories','new_arrivals','food_menu','fashion_collection','beauty_collection','electronics_collection','home_collection'),false)
    or jsonb_typeof(block->'title') is distinct from 'string' or char_length(block->>'title')>100
    or jsonb_typeof(block->'copy') is distinct from 'string' or char_length(block->>'copy')>500
    or jsonb_typeof(block->'limit') is distinct from 'number' or coalesce(block->>'limit','') !~ '^([1-9]|1[0-2])$'
    or jsonb_typeof(block->'hidden') is distinct from 'boolean' then return false; end if;
   ids:=array_append(ids,lower(block->>'id'));
  end loop;
 end loop;
 return true;
end;
$$;

create function public.admin_autosave_theme(theme uuid, expected_revision integer, config jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare revision integer;
begin
 perform public.theme_admin_required();
 if not public.theme_manifest_valid(config) then raise exception 'invalid manifest' using errcode='22023'; end if;
 update public.storefront_template_catalog set draft=config, base_style=config->>'style',
  draft_revision=draft_revision+1, updated_at=now() where id=theme and draft_revision=expected_revision
 returning draft_revision into revision;
 if not found then raise exception 'draft conflict' using errcode='40001'; end if;
 return revision;
end;
$$;
revoke all on function public.admin_autosave_theme(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.admin_autosave_theme(uuid,integer,jsonb) to authenticated;

create function public.get_public_store_theme_family(target_store uuid)
returns text language sql stable security definer set search_path = '' as $$
 select public.theme_store_family(s.id) from public.stores s where s.id=target_store and s.status='active';
$$;
revoke all on function public.get_public_store_theme_family(uuid) from public,anon,authenticated;
grant execute on function public.get_public_store_theme_family(uuid) to anon,authenticated;

create function public.validate_published_theme_industry()
returns trigger language plpgsql set search_path = '' as $$
begin
 if new.manifest->'schemaVersion'='2'::jsonb and exists (
   select 1 from jsonb_array_elements(new.manifest->'pages') p
   cross join lateral jsonb_array_elements(p->'blocks') b
   join (values ('food_menu','food'), ('fashion_collection','fashion'), ('beauty_collection','beauty'),
     ('electronics_collection','electronics'), ('home_collection','home')) as library(kind,family)
     on b->>'kind'=library.kind
   where not (library.family=any(new.families))
 ) then raise exception 'component industry is incompatible' using errcode='22023'; end if;
 return new;
end;
$$;
create trigger validate_published_theme_industry before insert on public.storefront_theme_versions
 for each row execute function public.validate_published_theme_industry();
revoke all on function public.validate_published_theme_industry() from public,anon,authenticated;
commit;
