begin;

alter table public.storefront_theme_versions
  add column release_name text check (char_length(release_name) between 1 and 100),
  add column release_notes text check (char_length(release_notes)<=4000),
  add column compatibility_notes text check (char_length(compatibility_notes)<=2000),
  add column change_type text check (change_type in ('major','minor','patch')),
  add column update_policy text not null default 'manual' check (update_policy='manual'),
  add column previous_version_id uuid,
  add foreign key(theme_id,previous_version_id) references public.storefront_theme_versions(theme_id,id);

with history as (
  select id,lag(id) over(partition by theme_id order by release_no) as previous
  from public.storefront_theme_versions
)
update public.storefront_theme_versions v set previous_version_id=h.previous from history h where h.id=v.id;

create table public.storefront_theme_version_events (
  id bigint generated always as identity primary key,
  theme_id uuid not null references public.storefront_template_catalog(id),
  store_id uuid references public.stores(id),
  source_version_id uuid references public.storefront_theme_versions(id),
  target_version_id uuid not null references public.storefront_theme_versions(id),
  actor uuid references auth.users(id) on delete set null,
  operation text not null check(operation in ('restore','update','rollback')),
  status text not null check(status in ('success','conflict','incompatible','failed')),
  issue text,
  started_at timestamptz not null,
  finished_at timestamptz not null default clock_timestamp(),
  check ((operation='restore')=(store_id is null))
);
create index theme_version_event_history on public.storefront_theme_version_events(theme_id,id desc);
create index theme_version_event_store_history on public.storefront_theme_version_events(theme_id,store_id,id desc) where store_id is not null;
alter table public.storefront_theme_version_events enable row level security;
revoke all on public.storefront_theme_version_events from public,anon,authenticated;

create function public.keep_theme_snapshot_immutable()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'released theme snapshots are immutable' using errcode='55000';
end;
$$;
create trigger keep_theme_snapshot_immutable before update or delete on public.storefront_theme_versions
for each row execute function public.keep_theme_snapshot_immutable();

create function public.theme_missing_release_assets(config jsonb)
returns bigint language sql stable security definer set search_path='' as $$
  select count(distinct b->>'image') from jsonb_array_elements(coalesce(config->'pages','[]'::jsonb)) p
  cross join lateral jsonb_array_elements(p->'blocks') b where b ? 'image'
  and not exists(select 1 from storage.objects o where o.bucket_id='platform-assets' and o.name=b->>'image');
$$;

create function public.admin_release_theme(theme uuid, expected_revision integer, release_version text,
  release_title text, notes text, kind text, compatibility text)
returns uuid language plpgsql security definer set search_path='' as $$
declare item public.storefront_template_catalog%rowtype; prior public.storefront_theme_versions%rowtype; published uuid;
begin
  perform public.theme_admin_required();
  if release_version is null or release_version !~ '^[0-9]{1,4}[.][0-9]{1,4}[.][0-9]{1,4}$'
    or (release_title is not null and char_length(btrim(release_title)) not between 1 and 100)
    or char_length(notes)>4000 or char_length(compatibility)>2000 or (kind is not null and kind not in ('major','minor','patch')) then
    raise exception 'invalid release metadata' using errcode='22023';
  end if;
  select * into item from public.storefront_template_catalog where id=theme for update;
  if not found or item.draft_revision is distinct from expected_revision then
    raise exception 'theme draft changed' using errcode='40001';
  end if;
  select * into prior from public.storefront_theme_versions where theme_id=theme order by release_no desc limit 1;
  if kind is not null then
    if release_version !~ '^(0|[1-9][0-9]{0,3})[.](0|[1-9][0-9]{0,3})[.](0|[1-9][0-9]{0,3})$' then
      raise exception 'invalid semantic version' using errcode='22023';
    end if;
    if prior.id is not null and (select string_to_array(release_version,'.')::int[] <= string_to_array(prior.version,'.')::int[]) then
      raise exception 'version must increase' using errcode='PT422';
    end if;
    if prior.id is not null and kind is distinct from (case
      when split_part(release_version,'.',1)::int<>split_part(prior.version,'.',1)::int then 'major'
      when split_part(release_version,'.',2)::int<>split_part(prior.version,'.',2)::int then 'minor'
      else 'patch' end) then raise exception 'version change type mismatch' using errcode='PT422'; end if;
  end if;
  if not public.theme_manifest_valid(item.draft) then raise exception 'invalid manifest' using errcode='22023'; end if;
  if public.theme_missing_release_assets(item.draft)>0 then raise exception 'theme image is missing' using errcode='PT423'; end if;
  insert into public.storefront_theme_versions(theme_id,version,manifest,name,description,preview_url,primary_family,families,
    price_vnd,published_by,release_name,release_notes,change_type,compatibility_notes,previous_version_id)
  values(item.id,release_version,item.draft,item.name,item.description,item.preview_url,item.primary_family,
    array_append(item.compatible_families,item.primary_family),item.price_vnd,auth.uid(),release_title,notes,kind,compatibility,prior.id)
  returning id into published;
  update public.storefront_template_catalog set lifecycle=case when item.lifecycle='draft' then 'published' else item.lifecycle end,
    is_enabled=case when item.lifecycle='draft' then true else item.is_enabled end,
    draft_revision=draft_revision+1,updated_at=now() where id=theme;
  return published;
end;
$$;

create or replace function public.admin_publish_theme(theme uuid, expected_revision integer, release_version text)
returns uuid language sql security definer set search_path='' as $$
  select public.admin_release_theme(theme,expected_revision,release_version,null,null,null,null);
$$;

create or replace function public.admin_restore_theme_version(theme uuid, release uuid, expected_revision integer)
returns integer language plpgsql security definer set search_path='' as $$
declare config jsonb; revision integer; started timestamptz := clock_timestamp();
begin
  perform public.theme_admin_required();
  select r.manifest into config from public.storefront_theme_versions r where r.id=release and r.theme_id=theme;
  if not found then raise exception 'version unavailable' using errcode='22023'; end if;
  revision := public.admin_autosave_theme(theme,expected_revision,config);
  insert into public.storefront_theme_version_events(theme_id,target_version_id,actor,operation,status,started_at)
  values(theme,release,auth.uid(),'restore','success',started);
  return revision;
end;
$$;

-- SQL null represents a missing key. JSON null remains a real value.
create function public.merge_store_theme_config(base jsonb, local_config jsonb, target jsonb, path text default '')
returns jsonb language plpgsql immutable set search_path='' as $$
declare
  merged jsonb; value jsonb; key text;
  base_ids text[]; local_ids text[]; target_ids text[]; sequence text[]; secondary text[];
  base_common text[]; local_common text[]; target_common text[];
  anchor integer; candidate text;
begin
  if local_config is not distinct from base then return target; end if;
  if target is not distinct from base or target is not distinct from local_config then return local_config; end if;
  if path ~ '/meta/(createdAt|updatedAt)$' then return coalesce(local_config,target); end if;
  if (base is null or jsonb_typeof(base)='object') and jsonb_typeof(local_config)='object' and jsonb_typeof(target)='object' then
    merged := '{}'::jsonb;
    for key in select k from jsonb_object_keys(coalesce(base,'{}'::jsonb) || local_config || target) k loop
      value := public.merge_store_theme_config(base->key,local_config->key,target->key,path || '/' || key);
      if value is not null then merged := merged || jsonb_build_object(key,value); end if;
    end loop;
    return merged;
  end if;
  if path ~ '/(pages|blocks)$' and (base is null or jsonb_typeof(base)='array') and jsonb_typeof(local_config)='array' and jsonb_typeof(target)='array' then
    base_ids := array(select b->>'id' from jsonb_array_elements(base) b);
    local_ids := array(select b->>'id' from jsonb_array_elements(local_config) b);
    target_ids := array(select b->>'id' from jsonb_array_elements(target) b);
    base_common := array(select x from unnest(base_ids) x where x=any(local_ids) and x=any(target_ids));
    local_common := array(select x from unnest(local_ids) x where x=any(base_common));
    target_common := array(select x from unnest(target_ids) x where x=any(base_common));
    if local_common<>base_common and target_common<>base_common and local_common<>target_common then
      raise exception 'theme configuration conflict' using errcode='PT422',detail=path;
    end if;
    if local_common<>base_common then
      sequence := local_ids; secondary := target_ids;
    else
      sequence := target_ids; secondary := local_ids;
    end if;
    anchor := 0;
    foreach candidate in array secondary loop
      if candidate=any(sequence) then
        anchor := array_position(sequence,candidate);
      else
        sequence := sequence[:anchor] || array[candidate] || sequence[anchor+1:];
        anchor := anchor+1;
      end if;
    end loop;
    merged := '[]'::jsonb;
    foreach key in array sequence loop
      value := public.merge_store_theme_config(
        (select b from jsonb_array_elements(base) b where b->>'id'=key),
        (select b from jsonb_array_elements(local_config) b where b->>'id'=key),
        (select b from jsonb_array_elements(target) b where b->>'id'=key),path || '/' || key);
      if value is not null then merged := merged || jsonb_build_array(value); end if;
    end loop;
    return merged;
  end if;
  raise exception 'theme configuration conflict' using errcode='PT422',detail=path;
end;
$$;

create function public.admin_theme_version_report(theme uuid, release_offset integer, store_offset integer, state_filter text, installed_version uuid, detail_version uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.theme_admin_required();
  if release_offset not between 0 and 1000000 or store_offset not between 0 and 1000000
    or coalesce(state_filter,'') not in ('','current','outdated','incompatible','inactive','failed') then
    raise exception 'invalid filters' using errcode='22023';
  end if;
  return (
    with latest as (
      select v.* from public.storefront_theme_versions v where v.theme_id=theme order by v.release_no desc limit 1
    ), installations as materialized (
      select a.store_id,s.name as store_name,a.version_id,v.version,v.release_no,a.updated_at,
        a.is_active and s.status='active' and l.revoked_at is null and coalesce(c.theme_family,'general')=any(v.families) as live,
        l.revoked_at is not null as license_revoked, coalesce(c.theme_family,'general') as family,
        n.version as latest_version,
        case when not a.is_active or s.status<>'active' or l.revoked_at is not null then 'inactive'
          when not (coalesce(c.theme_family,'general')=any(n.families)) then 'incompatible'
          when v.id=n.id then 'current' else 'outdated' end as state,
        attempt.status as last_attempt
      from public.storefront_store_theme a
      join public.stores s on s.id=a.store_id
      left join public.business_categories c on c.id=s.business_category_id
      join public.storefront_theme_licenses l on (l.store_id,l.theme_id)=(a.store_id,a.theme_id)
      join public.storefront_theme_versions v on v.id=a.version_id
      cross join latest n
      left join lateral (
        select e.status from public.storefront_theme_version_events e
        where e.theme_id=theme and e.store_id=a.store_id order by e.id desc limit 1
      ) attempt on true
      where a.theme_id=theme
    ), matches as (
      select * from installations i where (installed_version is null or i.version_id=installed_version)
      and (coalesce(state_filter,'')='' or case when state_filter='failed' then i.last_attempt in ('failed','conflict','incompatible') else i.state=state_filter end)
    ), release_rows as not materialized (
      select v.id,v.version,v.release_name,v.release_notes,v.compatibility_notes,v.change_type,v.update_policy,v.previous_version_id,
        prior.version as previous_version,v.published_at,coalesce(nullif(p.display_name,''),'Tài khoản '||left(v.published_by::text,8)) as actor,
        (select count(*) from installations i where i.live and i.version_id=v.id) as stores,
        (select count(*) from installations i where i.state<>'inactive' and i.release_no<v.release_no and i.family=any(v.families)) as eligible,
        (select count(*) from installations i where i.state<>'inactive' and not (i.family=any(v.families))) as incompatible,
        v.id=(select id from latest) as latest,v.release_no
      from public.storefront_theme_versions v
      left join public.storefront_theme_versions prior on prior.id=v.previous_version_id
      left join public.profiles p on p.id=v.published_by
      where v.theme_id=theme
    )
    select jsonb_build_object(
      'count',(select count(*) from public.storefront_theme_versions v where v.theme_id=theme),
      'latest',(select version from latest),
      'current',(select i.version from installations i where i.live group by i.version order by count(*) desc,max(i.release_no) desc limit 1),
      'stores',(select count(*) from installations where live),
      'outdated',(select count(*) from installations where state='outdated'),
      'incompatible',(select count(*) from installations where state='incompatible'),
      'draft_assets',(select public.theme_missing_release_assets(t.draft) from public.storefront_template_catalog t where t.id=theme),
      'draft_eligible',(select count(*) from installations i join public.storefront_template_catalog t on t.id=theme
        where i.state<>'inactive' and i.family=any(array_append(t.compatible_families,t.primary_family))),
      'store_count',(select count(*) from matches),
      'detail',(select to_jsonb(r)-'release_no' from release_rows r where r.id=detail_version),
      'releases',coalesce((select jsonb_agg(to_jsonb(r)-'release_no' order by r.release_no desc)
        from (select * from release_rows order by release_no desc limit 20 offset release_offset) r),'[]'::jsonb),
      'installations',coalesce((select jsonb_agg(to_jsonb(m) order by m.store_name,m.store_id) from (
        select * from matches order by store_name,store_id limit 15 offset store_offset
      ) m),'[]'::jsonb),
      'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.id desc) from (
        select e.id,e.operation,e.status,e.issue,e.started_at,e.finished_at,s.name as store_name,
          coalesce(nullif(p.display_name,''),case when e.actor is not null then 'Tài khoản '||left(e.actor::text,8) end) as actor,
          a.version as source,b.version as target
        from public.storefront_theme_version_events e
        left join public.stores s on s.id=e.store_id left join public.profiles p on p.id=e.actor
        left join public.storefront_theme_versions a on a.id=e.source_version_id
        join public.storefront_theme_versions b on b.id=e.target_version_id
        where e.theme_id=theme order by e.id desc limit 15
      ) e),'[]'::jsonb)
    )
  );
end;
$$;

create function public.apply_store_theme_release(shop uuid, theme uuid, release uuid, expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  installation public.storefront_store_theme%rowtype;
  old_release public.storefront_theme_versions%rowtype;
  next_release public.storefront_theme_versions%rowtype;
  merged_draft jsonb; merged_public jsonb;
  result text := 'success'; reason text; operation text := 'update';
  started timestamptz := clock_timestamp();
begin
  perform public.theme_owner_required(shop);
  perform 1 from public.stores where id=shop for update;
  select * into installation from public.storefront_store_theme where store_id=shop and theme_id=theme and is_active for update;
  if not found then raise exception 'installation unavailable' using errcode='42501'; end if;
  perform 1 from public.storefront_theme_licenses l where l.store_id=shop and l.theme_id=theme and l.revoked_at is null for share;
  if not found then raise exception 'installation unavailable' using errcode='42501'; end if;
  select * into next_release from public.storefront_theme_versions r where r.id=release and r.theme_id=theme;
  if not found then raise exception 'release unavailable' using errcode='42501'; end if;
  select * into strict old_release from public.storefront_theme_versions where id=installation.version_id;
  if old_release.id=next_release.id then return jsonb_build_object('status','success','unchanged',true); end if;
  if next_release.release_no<old_release.release_no then operation := 'rollback'; end if;
  if installation.revision is distinct from expected_revision then
    result := 'conflict'; reason := 'revision';
  elsif not (public.theme_store_family(shop)=any(next_release.families)) then
    result := 'incompatible'; reason := 'industry';
  else
    begin
      if installation.draft is not null then merged_draft := public.merge_store_theme_config(old_release.manifest,installation.draft,next_release.manifest); end if;
      if installation.published is not null then merged_public := public.merge_store_theme_config(old_release.manifest,installation.published,next_release.manifest); end if;
      if (merged_draft is not null and public.theme_manifest_valid(merged_draft) is not true)
        or (merged_public is not null and public.theme_manifest_valid(merged_public) is not true) then
        raise exception 'merged theme is incompatible' using errcode='PT422',detail='/manifest';
      end if;
      update public.storefront_store_theme a set version_id=release,draft=merged_draft,published=merged_public,
        revision=a.revision+1,updated_at=now() where a.store_id=shop and a.theme_id=theme;
    exception
      when sqlstate 'PT422' then
        get stacked diagnostics reason=PG_EXCEPTION_DETAIL;
        result := 'incompatible';
      when check_violation or sqlstate 'PT409' then
        result := 'failed'; reason := 'theme_policy';
    end;
  end if;
  insert into public.storefront_theme_version_events(theme_id,store_id,source_version_id,target_version_id,actor,operation,status,issue,started_at)
  values(theme,shop,old_release.id,next_release.id,auth.uid(),operation,result,left(reason,500),started);
  return jsonb_build_object('status',result,'issue',left(reason,500));
end;
$$;

create or replace function public.select_store_theme_version(shop uuid, theme uuid, release uuid, expected_revision integer)
returns void language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  result := public.apply_store_theme_release(shop,theme,release,expected_revision);
  if result->>'status'='conflict' then raise exception 'store theme changed' using errcode='40001'; end if;
  if result->>'status'<>'success' then raise exception 'store theme update unavailable' using errcode='PT422'; end if;
end;
$$;

revoke all on function public.keep_theme_snapshot_immutable(),public.theme_missing_release_assets(jsonb),public.admin_release_theme(uuid,integer,text,text,text,text,text),
  public.merge_store_theme_config(jsonb,jsonb,jsonb,text),public.apply_store_theme_release(uuid,uuid,uuid,integer),
  public.admin_theme_version_report(uuid,integer,integer,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_release_theme(uuid,integer,text,text,text,text,text),
  public.apply_store_theme_release(uuid,uuid,uuid,integer),public.admin_theme_version_report(uuid,integer,integer,text,uuid,uuid) to authenticated;

commit;
