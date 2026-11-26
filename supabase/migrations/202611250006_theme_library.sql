begin;

alter table public.storefront_template_catalog add column thumbnail_url text
  check (thumbnail_url is null or (char_length(thumbnail_url) <= 2048
    and thumbnail_url ~ '^https://[^/@?#[:space:]]+([/?#]|$)' and thumbnail_url !~ '[[:space:]]' and strpos(thumbnail_url,chr(92))=0));

create view public.admin_theme_library_rows with (security_invoker=true) as
with usage as (
  select a.theme_id, count(*) as installations,
    count(*) filter (where a.is_active and s.status='active' and l.revoked_at is null
      and coalesce(c.theme_family,'general')=any(v.families)) as active_stores
  from public.storefront_store_theme a
  join public.stores s on s.id=a.store_id
  left join public.business_categories c on c.id=s.business_category_id
  join public.storefront_theme_licenses l on (l.store_id,l.theme_id)=(a.store_id,a.theme_id)
  join public.storefront_theme_versions v on v.id=a.version_id
  group by a.theme_id
)
select t.id,t.name,t.theme_slug,t.description,t.category,t.primary_family,t.created_by,
  nullif(btrim(p.display_name),'') as creator,t.created_at,t.updated_at,t.lifecycle,t.is_enabled,t.draft_revision,
  t.thumbnail_url,t.preview_url,t.compatible_families,t.price_vnd,
  r.version,r.published_at,r.price_vnd as published_price,r.preview_url as published_preview,
  coalesce(u.installations,0) as installations,coalesce(u.active_stores,0) as active_stores,
  case when t.lifecycle<>'published' or r.version is null then 'unlisted'
    when not t.is_enabled then 'hidden'
    when not coalesce((select marketplace_open from public.storefront_theme_policy where id),false) then 'paused'
    else 'listed' end as distribution
from public.storefront_template_catalog t
left join public.profiles p on p.id=t.created_by
left join usage u on u.theme_id=t.id
left join lateral (
  select version,published_at,price_vnd,preview_url from public.storefront_theme_versions
  where theme_id=t.id order by release_no desc limit 1
) r on true;

revoke all on public.admin_theme_library_rows from public,anon,authenticated;

create function public.admin_list_theme_library(
  term text, release_state text, marketplace_state text, family text, theme_category text, creator_id uuid,
  date_field text, first_day date, last_day date, sort_by text, page_offset integer
) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.theme_admin_required();
  if page_offset is null or page_offset not between 0 and 1000000
    or sort_by is null or sort_by not in ('newest','oldest','name_asc','name_desc','installations','stores','updated')
    or date_field is null or date_field not in ('created','updated')
    or (first_day is not null and last_day is not null and first_day>last_day)
    or (release_state is not null and release_state not in ('draft','published','archived'))
    or (marketplace_state is not null and marketplace_state not in ('listed','hidden','unlisted','paused')) then
    raise exception 'invalid library filters' using errcode='22023';
  end if;

  return (
    with library as materialized (select * from public.admin_theme_library_rows),
    filtered as materialized (
      select * from library t
      where (nullif(term,'') is null or strpos(lower(concat_ws(' ', t.name,t.theme_slug,t.id,t.creator,t.created_by)),lower(left(term,100)))>0)
        and (release_state is null or t.lifecycle=release_state)
        and (marketplace_state is null or t.distribution=marketplace_state)
        and (family is null or t.primary_family=family)
        and (theme_category is null or t.category=theme_category)
        and (creator_id is null or t.created_by=creator_id)
        and (first_day is null or (case date_field when 'updated' then t.updated_at else t.created_at end)
          >= (first_day::timestamp at time zone 'Asia/Ho_Chi_Minh'))
        and (last_day is null or (case date_field when 'updated' then t.updated_at else t.created_at end)
          < ((last_day+1)::timestamp at time zone 'Asia/Ho_Chi_Minh'))
    ), ordered as (
      select f.*, row_number() over (order by
        case when sort_by='newest' then created_at end desc,
        case when sort_by='oldest' then created_at end,
        case when sort_by='updated' then updated_at end desc,
        case when sort_by='name_asc' then lower(name) end,
        case when sort_by='name_desc' then lower(name) end desc,
        case when sort_by='installations' then installations end desc,
        case when sort_by='stores' then active_stores end desc,
        id) as position
      from filtered f
    )
    select jsonb_build_object(
      'count',(select count(*) from filtered),
      'rows',coalesce((select jsonb_agg(to_jsonb(r)-'position' order by position)
        from (select * from ordered order by position limit 20 offset page_offset) r),'[]'::jsonb),
      'stats',(select jsonb_build_object('total',count(*),'draft',count(*) filter (where lifecycle='draft'),
        'published',count(*) filter (where lifecycle='published'),'archived',count(*) filter (where lifecycle='archived'),
        'listed',count(*) filter (where distribution='listed'),
        'paused',count(*) filter (where distribution in ('hidden','paused'))) from library),
      'categories',coalesce((select jsonb_agg(category order by category) from (
        select distinct category from library where category<>'' order by category limit 100
      ) c),'[]'::jsonb),
      'creators',coalesce((select jsonb_agg(to_jsonb(c) order by c.label,c.id) from (
        select distinct created_by as id,coalesce(creator,'Tài khoản '||left(created_by::text,8)) as label
        from library where created_by is not null order by label,id limit 100
      ) c),'[]'::jsonb)
    )
  );
end;
$$;

create function public.admin_get_theme_library(theme uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.theme_admin_required();
  return (
    select to_jsonb(r) || jsonb_build_object(
      'draft',t.draft,
      'licenses',(select count(*) from public.storefront_theme_licenses l where l.theme_id=theme),
      'orders',(select count(*) from public.storefront_theme_purchases p where p.theme_id=theme),
      'has_release', latest.id is not null,
      'published_manifest',latest.manifest,
      'published_family',latest.primary_family,
      'releases',coalesce((select jsonb_agg(to_jsonb(v) order by v.release_no desc) from (
        select id,version,published_at,release_no from public.storefront_theme_versions
        where theme_id=theme order by release_no desc limit 8
      ) v),'[]'::jsonb))
    from public.admin_theme_library_rows r
    join public.storefront_template_catalog t on t.id=r.id
    left join lateral (select id,manifest,primary_family from public.storefront_theme_versions
      where theme_id=theme order by release_no desc limit 1) latest on true
    where r.id=theme
  );
end;
$$;

create function public.admin_save_theme_library(
  theme uuid, copy_from uuid, expected_revision integer, title text, slug text, summary text,
  family text, theme_category text, image_url text, thumbnail text, initial_config jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  item public.storefront_template_catalog%rowtype;
  saved uuid;
  compatibility text[] := '{}';
  price integer := 0;
  config jsonb;
begin
  perform public.theme_admin_required();
  if (theme is not null and copy_from is not null) or expected_revision is null or expected_revision<0
    or title is null or char_length(btrim(title)) not between 2 and 100
    or slug is null or char_length(slug)>80 or slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or summary is null or char_length(summary)>1000
    or family is null or family not in ('food','fashion','beauty','electronics','home','general')
    or theme_category is null or char_length(theme_category)>80
    or (image_url is not null and (char_length(image_url)>2048 or image_url !~ '^https://[^/@?#[:space:]]+([/?#]|$)'
      or image_url ~ '[[:space:]]' or strpos(image_url,chr(92))>0))
    or (thumbnail is not null and (char_length(thumbnail)>2048 or thumbnail !~ '^https://[^/@?#[:space:]]+([/?#]|$)'
      or thumbnail ~ '[[:space:]]' or strpos(thumbnail,chr(92))>0)) then
    raise exception 'invalid theme metadata' using errcode='22023';
  end if;
  if coalesce(theme,copy_from) is not null then
    select * into item from public.storefront_template_catalog where id=coalesce(theme,copy_from) for update;
    if not found or item.draft_revision<>expected_revision then
      raise exception 'theme draft changed' using errcode='40001';
    end if;
    compatibility := array_remove(item.compatible_families,family);
    price := item.price_vnd;
    config := item.draft;
  else
    config := initial_config;
  end if;
  saved := public.admin_save_theme(theme,expected_revision,btrim(title),slug,btrim(summary),family,compatibility,price,image_url,config);
  update public.storefront_template_catalog set category=btrim(theme_category), thumbnail_url=thumbnail where id=saved;
  return saved;
end;
$$;

create function public.admin_change_theme_library(theme uuid, expected_revision integer, expected_visibility boolean, command text)
returns void language plpgsql security definer set search_path='' as $$
declare item public.storefront_template_catalog%rowtype;
begin
  perform public.theme_admin_required();
  select * into item from public.storefront_template_catalog where id=theme for update;
  if not found or item.draft_revision is distinct from expected_revision or item.is_enabled is distinct from expected_visibility then
    raise exception 'theme changed' using errcode='40001';
  end if;
  case command
    when 'archive' then perform public.admin_archive_theme(theme);
    when 'hide' then perform public.admin_theme_visibility(theme,false);
    when 'show' then perform public.admin_theme_visibility(theme,true);
    when 'delete' then
      if exists(select 1 from public.storefront_theme_licenses where theme_id=theme)
        or exists(select 1 from public.storefront_store_theme where theme_id=theme)
        or exists(select 1 from public.storefront_theme_purchases where theme_id=theme) then
        raise exception 'theme has dependent records' using errcode='23503';
      end if;
      perform public.admin_delete_unreleased_theme(theme);
    else raise exception 'invalid theme command' using errcode='22023';
  end case;
end;
$$;

revoke all on function public.admin_list_theme_library(text,text,text,text,text,uuid,text,date,date,text,integer),
  public.admin_get_theme_library(uuid),public.admin_save_theme_library(uuid,uuid,integer,text,text,text,text,text,text,text,jsonb),
  public.admin_change_theme_library(uuid,integer,boolean,text) from public,anon,authenticated;
grant execute on function public.admin_list_theme_library(text,text,text,text,text,uuid,text,date,date,text,integer),
  public.admin_get_theme_library(uuid),public.admin_save_theme_library(uuid,uuid,integer,text,text,text,text,text,text,text,jsonb),
  public.admin_change_theme_library(uuid,integer,boolean,text) to authenticated;

commit;
