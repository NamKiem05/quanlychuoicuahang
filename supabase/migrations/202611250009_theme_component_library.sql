begin;

alter table public.storefront_theme_policy
  add column deprecated_components text[] not null default '{}',
  add column component_status_updated_at jsonb not null default '{}' check (jsonb_typeof(component_status_updated_at)='object'),
  add constraint theme_component_status_disjoint check (
    not (disabled_components && deprecated_components)
    and array_position(deprecated_components,null) is null
    and deprecated_components <@ array['announcement','story','contact','testimonials','categories','new_arrivals',
      'food_menu','fashion_collection','beauty_collection','electronics_collection','home_collection']);

create function public.admin_set_theme_component_status(component text, next_state text, expected_state text)
returns void language plpgsql security definer set search_path='' as $$
declare rules public.storefront_theme_policy%rowtype; current_state text;
begin
  perform public.theme_admin_required();
  if component is null or component not in ('announcement','story','contact','testimonials','categories','new_arrivals',
      'food_menu','fashion_collection','beauty_collection','electronics_collection','home_collection')
    or next_state is null or next_state not in ('active','disabled','deprecated') then
    raise exception 'invalid component status' using errcode='22023';
  end if;
  select * into strict rules from public.storefront_theme_policy where id for update;
  current_state := case when component=any(rules.disabled_components) then 'disabled'
    when component=any(rules.deprecated_components) then 'deprecated' else 'active' end;
  if current_state is distinct from expected_state then
    raise exception 'component status changed' using errcode='40001';
  end if;
  if current_state=next_state then return; end if;
  update public.storefront_theme_policy set
    disabled_components=array_remove(rules.disabled_components,component)
      || case when next_state='disabled' then array[component] else '{}'::text[] end,
    deprecated_components=array_remove(rules.deprecated_components,component)
      || case when next_state='deprecated' then array[component] else '{}'::text[] end,
    component_status_updated_at=jsonb_set(rules.component_status_updated_at,array[component],to_jsonb(now())),
    updated_at=now(),updated_by=auth.uid()
  where id;
end;
$$;

create or replace function public.admin_update_theme_policy(open_marketplace boolean, custom_pages integer, blocked text[])
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.theme_admin_required();
  update public.storefront_theme_policy p set
    marketplace_open=coalesce(open_marketplace,p.marketplace_open), max_custom_pages=coalesce(custom_pages,p.max_custom_pages),
    disabled_components=coalesce(blocked,p.disabled_components),
    deprecated_components=case when blocked is null then p.deprecated_components
      else array(select k from unnest(p.deprecated_components) k where not k=any(blocked)) end,
    component_status_updated_at=p.component_status_updated_at || coalesce((
      select jsonb_object_agg(k,to_jsonb(now())) from (
        select distinct k from unnest(p.disabled_components || blocked) k
        where blocked is not null and (k=any(p.disabled_components)) <> (k=any(blocked))
      ) changes
    ),'{}'::jsonb),
    updated_by=auth.uid(),updated_at=now()
  where id;
end;
$$;

create function public.theme_component_availability()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or public.growdesk_session_is_active() is not true then
    raise exception 'not authorized' using errcode='42501';
  end if;
  return (select jsonb_build_object('disabled',disabled_components,'deprecated',deprecated_components)
    from public.storefront_theme_policy where id);
end;
$$;

create function public.theme_component_instances(config jsonb)
returns table(page_id text,block_id text,kind text) language sql immutable set search_path='' as $$
  select lower(p->>'id'), lower(b->>'id'), b->>'kind'
  from jsonb_array_elements(coalesce(config->'pages','[]'::jsonb)) p
  cross join lateral jsonb_array_elements(p->'blocks') b;
$$;

create function public.theme_component_family(kind text)
returns text language sql immutable set search_path='' as $$
  select case kind when 'food_menu' then 'food' when 'fashion_collection' then 'fashion'
    when 'beauty_collection' then 'beauty' when 'electronics_collection' then 'electronics'
    when 'home_collection' then 'home' end;
$$;

create function public.enforce_theme_component_additions()
returns trigger language plpgsql security definer set search_path='' as $$
declare blocked text[]; previous_draft jsonb; previous_public jsonb; target_theme uuid; base_release jsonb; allowed_families text[];
begin
  if tg_op='UPDATE' then
    if new.draft is not distinct from old.draft then return new; end if;
    previous_draft := old.draft;
  end if;
  if new.draft is null then return new; end if;
  select disabled_components || deprecated_components into blocked from public.storefront_theme_policy where id for share;
  if tg_table_name='storefront_template_catalog' then
    if tg_op='UPDATE' then target_theme := new.id; end if;
    allowed_families := array_append(new.compatible_families,new.primary_family);
  else
    if tg_op='UPDATE' then previous_public := old.published; end if;
    select manifest into base_release from public.storefront_theme_versions where id=new.version_id and theme_id=new.theme_id;
    allowed_families := array[public.theme_store_family(new.store_id)];
  end if;
  if exists (
    select 1 from public.theme_component_instances(new.draft) candidate
    where (candidate.kind=any(blocked) or (public.theme_component_family(candidate.kind) is not null
      and not coalesce(public.theme_component_family(candidate.kind)=any(allowed_families),false)))
      and not exists(select 1 from (
        select * from public.theme_component_instances(previous_draft)
        union all select * from public.theme_component_instances(previous_public)
        union all select * from public.theme_component_instances(base_release)
      ) retained where (retained.page_id,retained.block_id,retained.kind)=(candidate.page_id,candidate.block_id,candidate.kind))
      and not exists(select 1 from public.storefront_theme_versions v cross join lateral public.theme_component_instances(v.manifest) retained
        where v.theme_id=target_theme and (retained.page_id,retained.block_id,retained.kind)=(candidate.page_id,candidate.block_id,candidate.kind))
  ) then raise exception 'component is unavailable or incompatible for new instances' using errcode='PT409'; end if;
  return new;
end;
$$;

create or replace function public.validate_published_theme_industry()
returns trigger language plpgsql set search_path='' as $$
begin
  if exists (select 1 from public.theme_component_instances(new.manifest) b
    where public.theme_component_family(b.kind) is not null and not (public.theme_component_family(b.kind)=any(new.families)))
  then raise exception 'component industry is incompatible' using errcode='22023'; end if;
  return new;
end;
$$;

create trigger enforce_theme_catalog_component_additions before insert or update of draft on public.storefront_template_catalog
for each row execute function public.enforce_theme_component_additions();
create trigger enforce_store_theme_component_additions before insert or update of draft on public.storefront_store_theme
for each row execute function public.enforce_theme_component_additions();

-- Existing draft instances may still ship. Additions are checked when a draft is written.
create or replace function public.enforce_theme_release_settings()
returns trigger language plpgsql security definer set search_path='' as $$
declare max_pages integer;
begin
  select max_custom_pages into max_pages from public.storefront_theme_policy where id;
  if (select count(*) from jsonb_array_elements(coalesce(new.manifest->'pages','[]'::jsonb)) p where p->>'kind'='custom')>max_pages
  then raise exception 'manifest violates theme policy' using errcode='22023'; end if;
  return new;
end;
$$;

create function public.admin_theme_component_usage(component text default null, row_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.theme_admin_required();
  if row_offset is null or row_offset not between 0 and 1000000 then raise exception 'invalid offset' using errcode='22023'; end if;
  return (
    with refs as materialized (
      select t.id as theme_id,b.page_id,b.kind,null::uuid as release_id,null::text as version,
        null::timestamptz as published_at,null::bigint as release_no
      from public.storefront_template_catalog t cross join lateral public.theme_component_instances(t.draft) b
      union all
      select v.theme_id,b.page_id,b.kind,v.id,v.version,v.published_at,v.release_no
      from public.storefront_theme_versions v cross join lateral public.theme_component_instances(v.manifest) b
    ), summaries as (
      select kind,count(distinct theme_id) as themes,count(distinct (theme_id,page_id)) as pages,
        count(distinct release_id) as releases
      from refs group by kind
    ), matches as (
      select distinct r.theme_id,t.name,r.release_id,r.version,r.published_at,r.release_no
      from refs r join public.storefront_template_catalog t on t.id=r.theme_id where r.kind=component
    )
    select jsonb_build_object(
      'summaries',coalesce((select jsonb_object_agg(kind,to_jsonb(s)-'kind') from summaries s),'{}'::jsonb),
      'count',(select count(*) from matches),
      'references',coalesce((select jsonb_agg((to_jsonb(m)-'release_no') || jsonb_build_object('version_page',
        case when m.release_no is not null then 1+(select count(*) / 20 from public.storefront_theme_versions newer
          where newer.theme_id=m.theme_id and newer.release_no>m.release_no) end)
        order by m.published_at desc nulls last,m.theme_id,m.release_id)
        from (select * from matches order by published_at desc nulls last,theme_id,release_id limit 12 offset row_offset) m),'[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.admin_set_theme_component_status(text,text,text),public.theme_component_availability(),
  public.theme_component_instances(jsonb),public.theme_component_family(text),public.enforce_theme_component_additions(),public.admin_theme_component_usage(text,integer)
  from public,anon,authenticated;
grant execute on function public.admin_set_theme_component_status(text,text,text),public.theme_component_availability(),
  public.admin_theme_component_usage(text,integer) to authenticated;

commit;
