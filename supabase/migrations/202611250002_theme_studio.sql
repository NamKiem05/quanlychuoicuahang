begin;

alter table public.business_categories add column theme_family text not null default 'general'
  check (theme_family in ('food','fashion','beauty','electronics','home','general'));
update public.business_categories set theme_family = case
  when slug in ('thoi-trang','fashion') then 'fashion'
  when slug in ('my-pham','beauty') then 'beauty'
  when slug in ('dien-tu','electronics') then 'electronics'
  when slug in ('noi-that','gia-dung','home-living') then 'home'
  when merchandise_mode = 'food' then 'food' else 'general' end;
insert into public.business_categories(name,slug,merchandise_mode,theme_family)
select candidate.name, candidate.slug, candidate.mode, candidate.family
from (values ('Đồ ăn và đồ uống','do-an-do-uong','food','food'),
 ('Thời trang','thoi-trang','retail','fashion'), ('Mỹ phẩm','my-pham','retail','beauty'),
 ('Điện tử','dien-tu','retail','electronics'), ('Nội thất và gia dụng','noi-that-gia-dung','retail','home'),
 ('Cửa hàng tổng hợp','cua-hang-tong-hop','general','general')) candidate(name,slug,mode,family)
where not exists(select 1 from public.business_categories c where c.theme_family=candidate.family)
on conflict do nothing;

create function public.theme_manifest_valid(value jsonb)
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

alter table public.storefront_template_catalog
 add column theme_slug text unique check (theme_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(theme_slug) <= 80),
 add column primary_family text not null default 'general' check (primary_family in ('food','fashion','beauty','electronics','home','general')),
 add column compatible_families text[] not null default '{}' check (compatible_families <@ array['food','fashion','beauty','electronics','home','general'] and array_position(compatible_families,null) is null),
 add column price_vnd integer not null default 0 check (price_vnd between 0 and 100000000),
 add column lifecycle text not null default 'draft' check (lifecycle in ('draft','published','archived')),
 add column draft jsonb not null default '{"preset":"green","style":"original","order":["hero","menu","reviews","story"],"hidden":[],"headline":"","density":"comfortable","settings":{"font":"system","radius":"soft","width":"standard","columns":[4,3,2]}}'
   check (public.theme_manifest_valid(draft)),
 add column draft_revision integer not null default 0,
 add column created_by uuid references auth.users(id);
update public.storefront_template_catalog set theme_slug = 'mau-' || id::text,
  draft = jsonb_set(draft, '{style}', to_jsonb(base_style));
alter table public.storefront_template_catalog alter column theme_slug set not null;
revoke insert, update, delete on public.storefront_template_catalog from authenticated;
create policy theme_catalog_live_session on public.storefront_template_catalog as restrictive for select to authenticated
  using ((select public.growdesk_session_is_active()));

create table public.storefront_theme_versions (
 id uuid primary key default gen_random_uuid(),
 theme_id uuid not null references public.storefront_template_catalog(id),
 version text not null check (version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'),
 manifest jsonb not null check (public.theme_manifest_valid(manifest)),
 name text not null, description text not null, preview_url text,
 primary_family text not null, families text[] not null, price_vnd integer not null check (price_vnd >= 0),
 published_by uuid not null references auth.users(id), published_at timestamptz not null default now(),
 release_no bigint generated always as identity,
 unique(theme_id,version), unique(theme_id,id)
);
create index storefront_theme_latest on public.storefront_theme_versions(theme_id,release_no desc);

create table public.storefront_theme_purchases (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id), theme_id uuid not null, version_id uuid not null,
 foreign key(theme_id,version_id) references public.storefront_theme_versions(theme_id,id),
 amount_vnd integer not null check(amount_vnd > 0),
 transfer_code text not null unique default ('GDT' || upper(left(replace(gen_random_uuid()::text,'-',''),16))),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 bank_reference text unique, confirmed_by uuid references auth.users(id), confirmed_at timestamptz,
 unique(store_id,theme_id), unique(id,store_id,theme_id,version_id),
 check ((bank_reference is null and confirmed_by is null and confirmed_at is null)
   or (bank_reference is not null and confirmed_by is not null and confirmed_at is not null))
);

create table public.storefront_theme_licenses (
 store_id uuid not null references public.stores(id), theme_id uuid not null, version_id uuid not null,
 foreign key(theme_id,version_id) references public.storefront_theme_versions(theme_id,id),
 purchase_id uuid unique, foreign key(purchase_id,store_id,theme_id,version_id) references public.storefront_theme_purchases(id,store_id,theme_id,version_id),
 granted_at timestamptz not null default now(), revoked_at timestamptz,
 revoked_by uuid references auth.users(id), revocation_reason text,
 check ((revoked_at is null and revoked_by is null and revocation_reason is null)
   or (revoked_at is not null and revoked_by is not null and revocation_reason is not null)),
 primary key(store_id,theme_id)
);

create table public.storefront_store_theme (
 store_id uuid not null references public.stores(id),
 theme_id uuid not null, version_id uuid not null,
 foreign key(theme_id,version_id) references public.storefront_theme_versions(theme_id,id),
 foreign key(store_id,theme_id) references public.storefront_theme_licenses(store_id,theme_id),
 draft jsonb check (draft is null or public.theme_manifest_valid(draft)),
 published jsonb check (published is null or public.theme_manifest_valid(published)),
 is_active boolean not null default true,
 revision integer not null default 0, updated_at timestamptz not null default now(),
 primary key(store_id,theme_id)
);
create unique index storefront_one_active_theme on public.storefront_store_theme(store_id) where is_active;
create index storefront_active_theme_usage on public.storefront_store_theme(theme_id) where is_active;
create index storefront_theme_paid_orders on public.storefront_theme_purchases(theme_id) where confirmed_at is not null;

alter table public.storefront_theme_versions enable row level security;
alter table public.storefront_theme_purchases enable row level security;
alter table public.storefront_theme_licenses enable row level security;
alter table public.storefront_store_theme enable row level security;
revoke all on public.storefront_theme_versions, public.storefront_theme_purchases, public.storefront_theme_licenses, public.storefront_store_theme from public, anon, authenticated;
grant select on public.storefront_theme_versions, public.storefront_theme_purchases, public.storefront_theme_licenses, public.storefront_store_theme to authenticated;
create policy theme_version_admin on public.storefront_theme_versions for select to authenticated
  using ((select public.is_platform_admin() and public.growdesk_session_is_active()));
create policy theme_purchase_read on public.storefront_theme_purchases for select to authenticated
  using ((select public.growdesk_session_is_active()) and ((select public.is_platform_admin()) or public.has_store_role(store_id, array['owner']::public.store_member_role[])));
create policy theme_license_read on public.storefront_theme_licenses for select to authenticated
  using ((select public.growdesk_session_is_active()) and ((select public.is_platform_admin()) or public.has_store_role(store_id, array['owner']::public.store_member_role[])));
create policy theme_settings_read on public.storefront_store_theme for select to authenticated
  using ((select public.growdesk_session_is_active()) and ((select public.is_platform_admin()) or public.has_store_role(store_id, array['owner']::public.store_member_role[])));

create function public.theme_admin_required()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
 if public.is_platform_admin() is not true or public.growdesk_session_is_active() is not true then
  raise exception 'not authorized' using errcode='42501';
 end if;
end;
$$;

create function public.theme_store_family(shop uuid)
returns text language sql stable security definer set search_path = '' as $$
 select coalesce(c.theme_family, 'general') from public.stores s left join public.business_categories c on c.id=s.business_category_id where s.id=shop;
$$;

create function public.theme_owner_required(shop uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
 if public.has_store_role(shop,array['owner']::public.store_member_role[]) is not true or public.growdesk_session_is_active() is not true then
   raise exception 'not authorized' using errcode='42501';
 end if;
end;
$$;

create function public.admin_save_theme(theme uuid, expected_revision integer, title text, slug text,
 summary text, family text, compatibility text[], price integer, image_url text, config jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare saved uuid;
begin
 perform public.theme_admin_required();
 if public.theme_manifest_valid(config) is not true or (image_url is not null and image_url !~ '^https://[^/@?#]+([/?#]|$)') then
   raise exception 'invalid theme' using errcode='22023';
 end if;
 if theme is null then
   insert into public.storefront_template_catalog(name,theme_slug,description,primary_family,compatible_families,price_vnd,preview_url,base_style,draft,created_by)
   values (title,slug,summary,family,compatibility,price,image_url,config->>'style',config,auth.uid()) returning id into saved;
 else
   update public.storefront_template_catalog set name=title,theme_slug=slug,description=summary,primary_family=family,
     compatible_families=compatibility,price_vnd=price,preview_url=image_url,base_style=config->>'style',
     draft=config,draft_revision=draft_revision+1,updated_at=now()
   where id=theme and draft_revision=expected_revision returning id into saved;
 end if;
 if saved is null then raise exception 'theme draft changed' using errcode='40001'; end if;
 return saved;
end;
$$;

create function public.admin_publish_theme(theme uuid, expected_revision integer, release_version text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare item public.storefront_template_catalog%rowtype; published uuid;
begin
 perform public.theme_admin_required();
 select * into item from public.storefront_template_catalog where id=theme for update;
 if not found or item.draft_revision is distinct from expected_revision then
   raise exception 'theme draft changed' using errcode='40001';
 end if;
 insert into public.storefront_theme_versions(theme_id,version,manifest,name,description,preview_url,primary_family,families,price_vnd,published_by)
 values (item.id,release_version,item.draft,item.name,item.description,item.preview_url,item.primary_family,
   array_append(item.compatible_families,item.primary_family),item.price_vnd,auth.uid())
 returning id into published;
 update public.storefront_template_catalog set lifecycle='published',is_enabled=true,draft_revision=draft_revision+1,updated_at=now() where id=theme;
 return published;
end;
$$;

create function public.admin_archive_theme(theme uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 perform public.theme_admin_required();
 update public.storefront_template_catalog set lifecycle='archived',is_enabled=false,draft_revision=draft_revision+1,updated_at=now()
 where id=theme and lifecycle <> 'archived';
end;
$$;

create function public.admin_theme_overview(themes uuid[])
returns table(id uuid, version text, purchases bigint, active_stores bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
 perform public.theme_admin_required();
 if coalesce(cardinality(themes),0)>20 then raise exception 'too many themes' using errcode='22023'; end if;
 return query select t.id,
   (select r.version from public.storefront_theme_versions r where r.theme_id=t.id order by r.release_no desc limit 1),
   (select count(*) from public.storefront_theme_purchases p where p.theme_id=t.id and p.confirmed_at is not null),
   (select count(*) from public.storefront_store_theme a join public.storefront_theme_licenses l
     on l.store_id=a.store_id and l.theme_id=a.theme_id and l.revoked_at is null
     join public.stores s on s.id=a.store_id and s.status='active'
     join public.storefront_theme_versions r on r.id=a.version_id
     where a.theme_id=t.id and a.is_active and public.theme_store_family(a.store_id)=any(r.families))
 from public.storefront_template_catalog t where t.id=any(themes);
end;
$$;

create function public.list_store_themes(shop uuid)
returns table(id uuid,name text,description text,primary_family text,compatible_families text[],preview_url text,
 price_vnd integer,release_id uuid,version text,manifest jsonb,licensed boolean,owned_version uuid,
 purchase_id uuid,transfer_code text,purchase_amount integer,purchases bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
 perform public.theme_owner_required(shop);
 return query
 select t.id,v.name,v.description,v.primary_family,v.families,v.preview_url,v.price_vnd,v.id,v.version,v.manifest,
        l.store_id is not null and l.revoked_at is null,l.version_id,p.id,p.transfer_code,p.amount_vnd,
        (select count(*) from public.storefront_theme_purchases completed where completed.theme_id=t.id and completed.confirmed_at is not null)
 from public.storefront_template_catalog t
 left join public.storefront_theme_licenses l on l.theme_id=t.id and l.store_id=shop
 left join public.storefront_theme_purchases p on p.theme_id=t.id and p.store_id=shop and p.confirmed_at is null
 left join public.storefront_store_theme a on a.store_id=shop and a.theme_id=t.id
 join lateral (
   select r.* from public.storefront_theme_versions r where r.theme_id=t.id
     and (case when l.store_id is not null and l.revoked_at is null then r.id=coalesce(a.version_id,l.version_id)
       when p.id is not null then r.id=p.version_id else t.lifecycle='published' end)
   order by r.release_no desc limit 1
 ) v on true
 where public.theme_store_family(shop)=any(v.families) and (l.store_id is null or l.revoked_at is null)
 order by v.release_no desc, t.id;
end;
$$;

create function public.claim_store_theme(shop uuid, theme uuid, release uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare item public.storefront_theme_versions%rowtype; result uuid; status text;
begin
 perform public.theme_owner_required(shop);
 select lifecycle into status from public.storefront_template_catalog where id=theme for update;
 if status is distinct from 'published' then raise exception 'theme unavailable' using errcode='22023'; end if;
 select * into item from public.storefront_theme_versions where theme_id=theme order by release_no desc limit 1;
 if not found or item.id is distinct from release or not coalesce(public.theme_store_family(shop)=any(item.families),false) then
   raise exception 'release unavailable' using errcode='22023';
 end if;
 if exists(select 1 from public.storefront_theme_licenses where store_id=shop and theme_id=theme) then return null; end if;
 select id into result from public.storefront_theme_purchases where store_id=shop and theme_id=theme;
 if found then return result; end if;
 if item.price_vnd=0 then
   insert into public.storefront_theme_licenses(store_id,theme_id,version_id) values(shop,theme,item.id);
   return null;
 end if;
 insert into public.storefront_theme_purchases(store_id,theme_id,version_id,amount_vnd,created_by)
 values(shop,theme,item.id,item.price_vnd,auth.uid()) returning id into result;
 return result;
end;
$$;

create function public.admin_confirm_theme_transfer(purchase uuid, received integer, reference text)
returns void language plpgsql security definer set search_path = '' as $$
declare order_row public.storefront_theme_purchases%rowtype; normalized text := upper(btrim(reference));
begin
 perform public.theme_admin_required();
 select * into order_row from public.storefront_theme_purchases where id=purchase for update;
 if not found or received is distinct from order_row.amount_vnd or normalized is null
   or normalized !~ '^[A-Z0-9][A-Z0-9 ./_-]{2,119}$' then raise exception 'invalid transfer' using errcode='22023'; end if;
 if order_row.bank_reference=normalized then return; end if;
 if order_row.confirmed_at is not null then raise exception 'already confirmed' using errcode='22023'; end if;
 update public.storefront_theme_purchases set bank_reference=normalized,confirmed_at=now(),confirmed_by=auth.uid() where id=purchase;
 insert into public.storefront_theme_licenses(store_id,theme_id,version_id,purchase_id)
 values(order_row.store_id,order_row.theme_id,order_row.version_id,order_row.id);
end;
$$;

create function public.admin_revoke_theme_license(shop uuid, theme uuid, reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
 perform public.theme_admin_required();
 if char_length(btrim(coalesce(reason,''))) not between 5 and 500 then raise exception 'invalid reason' using errcode='22023'; end if;
 update public.storefront_theme_licenses set revoked_at=now(),revoked_by=auth.uid(),revocation_reason=btrim(reason)
 where store_id=shop and theme_id=theme and revoked_at is null;
end;
$$;

create function public.activate_store_theme(shop uuid, theme uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare licensed uuid;
begin
 perform public.theme_owner_required(shop);
 perform 1 from public.stores where id=shop for update;
 select l.version_id into licensed from public.storefront_theme_licenses l join public.storefront_theme_versions r on r.id=l.version_id
 left join public.storefront_store_theme a on a.store_id=shop and a.theme_id=l.theme_id
 left join public.storefront_theme_versions selected on selected.id=a.version_id
 where l.store_id=shop and l.theme_id=theme and l.revoked_at is null and public.theme_store_family(shop)=any(coalesce(selected.families,r.families))
 for update of l;
 if not found then raise exception 'license unavailable' using errcode='42501'; end if;
 update public.storefront_store_theme set is_active=false where store_id=shop and theme_id <> theme and is_active;
 insert into public.storefront_store_theme(store_id,theme_id,version_id) values(shop,theme,licensed)
 on conflict(store_id,theme_id) do update set is_active=true,updated_at=now();
end;
$$;

create function public.save_store_theme(shop uuid, theme uuid, expected_revision integer, config jsonb, operation text)
returns void language plpgsql security definer set search_path = '' as $$
begin
 perform public.theme_owner_required(shop);
 if operation is null or operation not in ('draft','publish','reset','deactivate')
   or (operation='draft' and public.theme_manifest_valid(config) is not true) then raise exception 'invalid configuration' using errcode='22023'; end if;
 perform 1 from public.stores where id=shop for update;
 update public.storefront_store_theme a set
   draft=case when operation='reset' then null when operation='draft' then config else a.draft end,
   published=case when operation='reset' then null when operation='publish' then a.draft else a.published end,
   is_active=operation <> 'deactivate',
   revision=a.revision+1, updated_at=now()
 where a.store_id=shop and a.theme_id=theme and a.is_active and a.revision=expected_revision and (operation <> 'publish' or a.draft is not null)
 and (operation='deactivate' or exists (select 1 from public.storefront_theme_licenses l join public.storefront_theme_versions r on r.id=a.version_id
   where l.store_id=a.store_id and l.theme_id=a.theme_id and l.revoked_at is null and public.theme_store_family(shop)=any(r.families)));
 if not found then raise exception 'store theme changed' using errcode='40001'; end if;
end;
$$;

create function public.list_licensed_theme_versions(shop uuid, theme uuid)
returns table(id uuid,version text)
language plpgsql stable security definer set search_path = '' as $$
begin
 perform public.theme_owner_required(shop);
 return query select r.id,r.version from public.storefront_theme_versions r
 where r.theme_id=theme and public.theme_store_family(shop)=any(r.families)
   and exists(select 1 from public.storefront_theme_licenses l where l.store_id=shop and l.theme_id=theme and l.revoked_at is null)
 order by r.release_no desc;
end;
$$;

create function public.select_store_theme_version(shop uuid, theme uuid, release uuid, expected_revision integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
 perform public.theme_owner_required(shop);
 perform 1 from public.stores where id=shop for update;
 if not exists(select 1 from public.list_licensed_theme_versions(shop,theme) r where r.id=release) then
   raise exception 'release unavailable' using errcode='42501';
 end if;
 update public.storefront_store_theme a set version_id=release,revision=a.revision+1,updated_at=now()
 where a.store_id=shop and a.theme_id=theme and a.is_active and a.revision=expected_revision;
 if not found then raise exception 'store theme changed' using errcode='40001'; end if;
end;
$$;

create function public.get_public_store_theme(target_store uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
 select coalesce(a.published,v.manifest)
 from public.storefront_store_theme a
 join public.stores s on s.id=a.store_id and s.status='active'
 join public.storefront_theme_versions v on v.id=a.version_id and v.theme_id=a.theme_id
 join public.storefront_theme_licenses l on l.store_id=a.store_id and l.theme_id=a.theme_id
   and l.revoked_at is null
 where a.store_id=target_store and a.is_active and public.theme_store_family(s.id)=any(v.families);
$$;

revoke all on function public.theme_admin_required(),public.theme_store_family(uuid),public.theme_owner_required(uuid),
 public.admin_save_theme(uuid,integer,text,text,text,text,text[],integer,text,jsonb),public.admin_publish_theme(uuid,integer,text),
 public.admin_archive_theme(uuid),public.list_store_themes(uuid),public.claim_store_theme(uuid,uuid,uuid),
 public.admin_confirm_theme_transfer(uuid,integer,text),public.admin_revoke_theme_license(uuid,uuid,text),
 public.activate_store_theme(uuid,uuid),public.save_store_theme(uuid,uuid,integer,jsonb,text),public.get_public_store_theme(uuid)
 ,public.list_licensed_theme_versions(uuid,uuid),public.select_store_theme_version(uuid,uuid,uuid,integer),public.admin_theme_overview(uuid[])
 from public, anon, authenticated;
grant execute on function public.admin_save_theme(uuid,integer,text,text,text,text,text[],integer,text,jsonb),
 public.admin_publish_theme(uuid,integer,text),public.admin_archive_theme(uuid),public.list_store_themes(uuid),
 public.claim_store_theme(uuid,uuid,uuid),public.admin_confirm_theme_transfer(uuid,integer,text),
 public.admin_revoke_theme_license(uuid,uuid,text),public.activate_store_theme(uuid,uuid),public.save_store_theme(uuid,uuid,integer,jsonb,text)
 ,public.list_licensed_theme_versions(uuid,uuid),public.select_store_theme_version(uuid,uuid,uuid,integer),public.admin_theme_overview(uuid[])
 to authenticated;
grant execute on function public.get_public_store_theme(uuid) to anon, authenticated;
commit;
