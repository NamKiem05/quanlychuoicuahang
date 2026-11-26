begin;

create function public.admin_create_theme_from_source(
  title text, slug text, summary text, category_id uuid, method text,
  source_theme uuid, source_version text, source_revision integer, image_url text, thumbnail text
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  category public.business_categories%rowtype;
  source public.storefront_template_catalog%rowtype;
  release public.storefront_theme_versions%rowtype;
  config jsonb; saved uuid; compatible text[] := '{}';
  policy public.storefront_theme_policy%rowtype;
begin
  perform public.theme_admin_required();
  if method is null or method not in ('blank','starter','clone') or
    (method='blank' and (source_theme is not null or source_version is not null or source_revision is not null))
    or (method='starter' and (source_theme is null or source_version is null or source_revision is not null))
    or (method='clone' and (source_theme is null or source_revision is null or source_revision<0 or source_version is not null))
    then raise exception 'invalid initialization method' using errcode='22023'; end if;
  select * into category from public.business_categories where id=category_id for share;
  if not found then raise exception 'category unavailable' using errcode='PT404'; end if;
  select * into strict policy from public.storefront_theme_policy where id;
  if method='blank' then
    config := '{"preset":"green","style":"original","order":["hero","menu","reviews","story"],"hidden":[],"headline":"","density":"comfortable","settings":{"font":"system","radius":"soft","width":"standard","columns":[4,3,2]}}';
    config := config || jsonb_build_object('schemaVersion',2,'pages',jsonb_build_array(jsonb_build_object(
      'id',gen_random_uuid(),'kind','home','slug','home','title','Trang chủ','description','','visible',true,'blocks','[]'::jsonb)));
  else
    select * into source from public.storefront_template_catalog where id=source_theme for share;
    if not found then raise exception 'source theme unavailable' using errcode='PT410'; end if;
    if method='starter' then
      select * into release from public.storefront_theme_versions where theme_id=source_theme and version=source_version;
      if not found or source.lifecycle<>'published' then raise exception 'starter unavailable' using errcode='PT410'; end if;
      config := release.manifest;
      compatible := release.families;
      image_url := coalesce(image_url,release.preview_url);
    else
      if source.draft_revision<>source_revision then raise exception 'source draft changed' using errcode='40001'; end if;
      config := source.draft;
      compatible := array_append(source.compatible_families,source.primary_family);
      image_url := coalesce(image_url,source.preview_url);
      thumbnail := coalesce(thumbnail,source.thumbnail_url);
    end if;
    if public.theme_manifest_valid(config) is not true or not (category.theme_family=any(compatible)) then
      raise exception 'incompatible initialization source' using errcode='PT422';
    end if;
    if public.theme_missing_release_assets(config)>0 then raise exception 'source asset missing' using errcode='PT423'; end if;
    if config->'schemaVersion'='2'::jsonb then
      if (select count(*) from jsonb_array_elements(config->'pages') p where p->>'kind'='custom')>policy.max_custom_pages then
        raise exception 'source exceeds page limit' using errcode='PT422';
      end if;
      config := jsonb_set(config,'{pages}',coalesce((
        select jsonb_agg((p.value-'id'-'blocks') || jsonb_build_object('id',gen_random_uuid(),'blocks',coalesce((
          select jsonb_agg((b.value-'id') || jsonb_build_object('id',gen_random_uuid()) order by b.ordinality)
          from jsonb_array_elements(p.value->'blocks') with ordinality b
        ),'[]'::jsonb)) order by p.ordinality)
        from jsonb_array_elements(config->'pages') with ordinality p
      ),'[]'::jsonb));
    else
      config := config || jsonb_build_object('schemaVersion',2,'pages',jsonb_build_array(jsonb_build_object(
        'id',gen_random_uuid(),'kind','home','slug','home','title','Trang chủ','description','','visible',true,'blocks','[]'::jsonb)));
    end if;
  end if;
  saved := public.admin_save_theme(null,0,btrim(title),slug,btrim(summary),category.theme_family,
    array_remove(compatible,category.theme_family),0,image_url,config);
  update public.storefront_template_catalog set category=category.name,thumbnail_url=thumbnail where id=saved;
  return saved;
end;
$$;

create function public.admin_list_theme_creation_sources(method text, term text, page_offset integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.theme_admin_required();
  if method is null or method not in ('clone','starter') or page_offset is null or page_offset not between 0 and 100000
    then raise exception 'invalid source search' using errcode='22023'; end if;
  return (
    with candidates as (
      select t.id,case when method='starter' then v.name else t.name end as name,t.theme_slug,t.lifecycle,t.category,
        case when method='starter' then v.description else t.description end as description,
        case when method='starter' then v.preview_url else coalesce(t.thumbnail_url,t.preview_url) end as image,
        v.version,t.draft_revision,
        case when method='starter' then v.families else array_append(t.compatible_families,t.primary_family) end as families
      from public.storefront_template_catalog t left join lateral (
        select * from public.storefront_theme_versions where theme_id=t.id order by release_no desc limit 1
      ) v on true
      where method='clone' or (t.lifecycle='published' and v.id is not null)
    ), matches as (
      select * from candidates c where coalesce(term,'')='' or strpos(lower(concat_ws(' ',name,theme_slug)),lower(left(term,100)))>0
    )
    select jsonb_build_object('count',(select count(*) from matches),'rows',coalesce((
      select jsonb_agg(to_jsonb(r) order by r.name,r.id) from (
        select * from matches order by name,id limit 12 offset page_offset
      ) r
    ),'[]'::jsonb))
  );
end;
$$;

revoke all on function public.admin_create_theme_from_source(text,text,text,uuid,text,uuid,text,integer,text,text),
  public.admin_list_theme_creation_sources(text,text,integer) from public,anon,authenticated;
grant execute on function public.admin_create_theme_from_source(text,text,text,uuid,text,uuid,text,integer,text,text),
  public.admin_list_theme_creation_sources(text,text,integer) to authenticated;

commit;
