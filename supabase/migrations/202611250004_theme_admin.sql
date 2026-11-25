begin;
create table public.storefront_theme_policy (
 id boolean primary key default true check(id),
 marketplace_open boolean not null default true,
 max_custom_pages integer not null default 16 check(max_custom_pages between 0 and 16),
 disabled_components text[] not null default '{}' check(disabled_components <@ array['announcement','story','contact','testimonials','categories','new_arrivals','food_menu','fashion_collection','beauty_collection','electronics_collection','home_collection'] and array_position(disabled_components,null) is null),
 updated_by uuid references auth.users(id), updated_at timestamptz not null default now()
);
insert into public.storefront_theme_policy(id) values(true);
alter table public.storefront_theme_policy enable row level security;
revoke all on public.storefront_theme_policy from public,anon,authenticated;
grant select on public.storefront_theme_policy to authenticated;
create policy theme_policy_admin on public.storefront_theme_policy for select to authenticated
 using ((select public.is_platform_admin() and public.growdesk_session_is_active()));

alter table public.storefront_theme_licenses add column granted_by uuid references auth.users(id), add column grant_reason text
 check(grant_reason is null or char_length(grant_reason) between 5 and 500);

create function public.admin_update_theme_policy(open_marketplace boolean, custom_pages integer, blocked text[])
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.theme_admin_required();
 update public.storefront_theme_policy set marketplace_open=coalesce(open_marketplace,marketplace_open), max_custom_pages=coalesce(custom_pages,max_custom_pages),
   disabled_components=blocked,updated_by=auth.uid(),updated_at=now() where id;
end;
$$;

create function public.admin_theme_visibility(theme uuid, visible boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.theme_admin_required();
 update public.storefront_template_catalog t set is_enabled=visible,updated_at=now()
 where t.id=theme and t.lifecycle='published'
   and exists(select 1 from public.storefront_theme_versions v where v.theme_id=t.id);
 if not found then raise exception 'theme not published' using errcode='22023'; end if;
end;
$$;

create function public.admin_delete_unreleased_theme(theme uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.theme_admin_required();
 delete from public.storefront_template_catalog t where t.id=theme and t.lifecycle='draft'
 and not exists(select 1 from public.storefront_theme_versions v where v.theme_id=t.id);
 if not found then raise exception 'only unused drafts can be deleted' using errcode='22023'; end if;
end;
$$;

create function public.admin_grant_free_theme(shop uuid, theme uuid, reason text)
returns void language plpgsql security definer set search_path='' as $$
declare release public.storefront_theme_versions%rowtype;
begin
 perform public.theme_admin_required();
 if char_length(trim(coalesce(reason,''))) not between 5 and 500 then raise exception 'invalid reason' using errcode='22023'; end if;
 perform 1 from public.storefront_template_catalog t where t.id=theme and t.lifecycle='published' for update;
 if not found then raise exception 'theme unavailable' using errcode='22023'; end if;
 select * into release from public.storefront_theme_versions v where v.theme_id=theme order by v.release_no desc limit 1;
 if not found or release.price_vnd<>0 or not coalesce(public.theme_store_family(shop)=any(release.families),false)
 or exists(select 1 from public.storefront_theme_purchases p where p.store_id=shop and p.theme_id=theme)
 or exists(select 1 from public.storefront_theme_licenses l where l.store_id=shop and l.theme_id=theme and l.revoked_at is not null) then
   raise exception 'license unavailable' using errcode='22023';
 end if;
 insert into public.storefront_theme_licenses(store_id,theme_id,version_id,granted_by,grant_reason)
 values(shop,theme,release.id,auth.uid(),trim(reason)) on conflict(store_id,theme_id) do nothing;
end;
$$;

create function public.enforce_theme_release_settings()
returns trigger language plpgsql security definer set search_path='' as $$
declare rules public.storefront_theme_policy%rowtype;
begin
 select * into rules from public.storefront_theme_policy where id;
 if (select count(*) from jsonb_array_elements(coalesce(new.manifest->'pages','[]'::jsonb)) p where p->>'kind'='custom')>rules.max_custom_pages
 or exists(select 1 from jsonb_array_elements(coalesce(new.manifest->'pages','[]'::jsonb)) p
  cross join lateral jsonb_array_elements(p->'blocks') b where b->>'kind'=any(rules.disabled_components))
 then raise exception 'manifest violates theme policy' using errcode='22023'; end if;
 return new;
end;
$$;
create trigger enforce_theme_release_settings before insert on public.storefront_theme_versions
 for each row execute function public.enforce_theme_release_settings();

create function public.admin_theme_dashboard()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform public.theme_admin_required();
 return jsonb_build_object(
 'total',(select count(*) from public.storefront_template_catalog),
 'draft',(select count(*) from public.storefront_template_catalog where lifecycle='draft'),
 'published',(select count(*) from public.storefront_template_catalog where lifecycle='published'),
 'selling',(select count(*) from public.storefront_template_catalog t join lateral
   (select price_vnd from public.storefront_theme_versions v where v.theme_id=t.id order by v.release_no desc limit 1) v on true
   where t.lifecycle='published' and t.is_enabled and v.price_vnd>0 and (select marketplace_open from public.storefront_theme_policy where id)),
 'stores',(select count(*) from public.storefront_store_theme a where a.is_active and public.get_public_store_theme(a.store_id) is not null),
 'licenses',(select count(*) from public.storefront_theme_licenses),
 'orders',(select count(*) from public.storefront_theme_purchases),
 'revenue',(select coalesce(sum(amount_vnd),0) from public.storefront_theme_purchases where confirmed_at is not null),
 'monthly',(select jsonb_agg(to_jsonb(d) order by d.month) from (
   select to_char(date_trunc('month',confirmed_at at time zone 'Asia/Ho_Chi_Minh'),'YYYY-MM') as "month",sum(amount_vnd) as amount
   from public.storefront_theme_purchases where confirmed_at>=now()-interval '12 months' group by 1) d),
 'families',(select jsonb_agg(to_jsonb(d) order by d.family) from (
   select primary_family family,count(*) count from public.storefront_template_catalog group by 1) d),
 'popular',(select jsonb_agg(to_jsonb(d) order by d.count desc,d.name) from (
   select t.name,count(*) count from public.storefront_store_theme a join public.storefront_template_catalog t on t.id=a.theme_id
   where a.is_active and public.get_public_store_theme(a.store_id) is not null group by t.id,t.name order by count desc,t.name limit 6) d),
 'releases',(select jsonb_agg(to_jsonb(d) order by d.published_at desc,d.version) from (
   select name,version,published_at from public.storefront_theme_versions order by release_no desc limit 8) d),
 'activity',(select jsonb_agg(to_jsonb(d) order by d.event_at desc,d.kind,d.name) from (
   select * from (
     select r.published_at as event_at,'published' as kind,r.name from public.storefront_theme_versions r
     union all select l.granted_at,'granted',t.name from public.storefront_theme_licenses l join public.storefront_template_catalog t on t.id=l.theme_id
     union all select l.revoked_at,'revoked',t.name from public.storefront_theme_licenses l join public.storefront_template_catalog t on t.id=l.theme_id where l.revoked_at is not null
     union all select p.confirmed_at,'confirmed',p.transfer_code from public.storefront_theme_purchases p where p.confirmed_at is not null
   ) events order by event_at desc,kind,name limit 8
 ) d),
 'orders_recent',(select jsonb_agg(to_jsonb(d) order by d.created_at desc) from (
   select transfer_code,amount_vnd,confirmed_at,created_at from public.storefront_theme_purchases order by created_at desc,id limit 8) d)
 );
end;
$$;

revoke all on function public.admin_update_theme_policy(boolean,integer,text[]),public.admin_theme_visibility(uuid,boolean),
 public.admin_delete_unreleased_theme(uuid),public.admin_grant_free_theme(uuid,uuid,text),public.admin_theme_dashboard(),
 public.enforce_theme_release_settings() from public,anon,authenticated;
grant execute on function public.admin_update_theme_policy(boolean,integer,text[]),public.admin_theme_visibility(uuid,boolean),
 public.admin_delete_unreleased_theme(uuid),public.admin_grant_free_theme(uuid,uuid,text),public.admin_theme_dashboard() to authenticated;

create or replace function public.list_store_themes(shop uuid)
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
       when p.id is not null then r.id=p.version_id else t.lifecycle='published' and t.is_enabled and (select policy.marketplace_open from public.storefront_theme_policy policy where policy.id) end)
   order by r.release_no desc limit 1
 ) v on true
 where public.theme_store_family(shop)=any(v.families) and (l.store_id is null or l.revoked_at is null)
 order by v.release_no desc, t.id;
end;
$$;

create or replace function public.claim_store_theme(shop uuid, theme uuid, release uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare item public.storefront_theme_versions%rowtype; result uuid; status text;
begin
 perform public.theme_owner_required(shop);
 select lifecycle into status from public.storefront_template_catalog where id=theme and is_enabled for update;
 if status is distinct from 'published' or not coalesce((select marketplace_open from public.storefront_theme_policy where id),false) then raise exception 'theme unavailable' using errcode='22023'; end if;
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

create function public.admin_list_theme_licenses(term text, state text, offset_at integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform public.theme_admin_required();
 return (
 with matches as (
  select l.store_id,l.theme_id,s.name as store_name,t.name as theme_name,
   coalesce(pr.display_name,'') owner_name,r.version,l.granted_at,l.granted_by,l.grant_reason,
   l.revoked_at,l.revoked_by,l.revocation_reason,l.purchase_id,
   a.is_active is true and l.revoked_at is null and public.get_public_store_theme(s.id) is not null as in_use
  from public.storefront_theme_licenses l
  join public.stores s on s.id=l.store_id
  join public.storefront_template_catalog t on t.id=l.theme_id
  join public.storefront_theme_versions r on r.id=l.version_id
  left join lateral (select m.user_id from public.store_members m where m.store_id=s.id and m.role='owner'
    order by m.created_at,m.user_id limit 1) owner_membership on s.billing_owner_id is null
  left join public.profiles pr on pr.id=coalesce(s.billing_owner_id,owner_membership.user_id)
  left join public.storefront_store_theme a on a.store_id=l.store_id and a.theme_id=l.theme_id
  where (coalesce(state,'')='' or (state='revoked' and l.revoked_at is not null) or (state='active' and l.revoked_at is null))
   and (coalesce(term,'')='' or strpos(lower(concat_ws(' ',s.name,s.slug,t.name,pr.display_name,l.store_id,l.theme_id)),lower(left(term,80)))>0)
 )
 select jsonb_build_object('count',(select count(*) from matches),'rows',coalesce(
   (select jsonb_agg(to_jsonb(m) order by m.granted_at desc,m.store_id,m.theme_id) from (
     select * from matches order by granted_at desc,store_id,theme_id offset greatest(offset_at,0) limit 20
   ) m),'[]'::jsonb))
 );
end;
$$;

create function public.admin_restore_theme_version(theme uuid, release uuid, expected_revision integer)
returns integer language plpgsql security definer set search_path='' as $$
declare config jsonb;
begin
 perform public.theme_admin_required();
 select r.manifest into config from public.storefront_theme_versions r where r.id=release and r.theme_id=theme;
 if not found then raise exception 'version unavailable' using errcode='22023'; end if;
 return public.admin_autosave_theme(theme,expected_revision,config);
end;
$$;

alter table public.support_tickets add column priority text not null default 'normal' check(priority in ('low','normal','high'));
create index theme_support_queue on public.support_tickets(created_at desc,id) where category='website';
create function public.admin_theme_ticket_priority(ticket uuid, level text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.theme_admin_required();
 update public.support_tickets set priority=level,updated_at=now() where id=ticket and category='website';
 if not found then raise exception 'ticket unavailable' using errcode='22023'; end if;
end;
$$;

revoke all on function public.admin_list_theme_licenses(text,text,integer),public.admin_restore_theme_version(uuid,uuid,integer),
 public.admin_theme_ticket_priority(uuid,text) from public,anon,authenticated;
grant execute on function public.admin_list_theme_licenses(text,text,integer),public.admin_restore_theme_version(uuid,uuid,integer),
 public.admin_theme_ticket_priority(uuid,text) to authenticated;
create function public.admin_theme_version_usage(theme uuid)
returns table(id uuid,count bigint) language plpgsql stable security definer set search_path='' as $$
begin
 perform public.theme_admin_required();
 return query select r.id,count(a.store_id)
 from public.storefront_theme_versions r left join public.storefront_store_theme a
   on a.version_id=r.id and a.is_active and public.get_public_store_theme(a.store_id) is not null
 where r.theme_id=theme group by r.id;
end;
$$;
revoke all on function public.admin_theme_version_usage(uuid) from public,anon,authenticated;
grant execute on function public.admin_theme_version_usage(uuid) to authenticated;
create or replace function public.admin_confirm_theme_transfer(purchase uuid, received integer, reference text)
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
 insert into public.storefront_theme_licenses(store_id,theme_id,version_id,purchase_id,granted_by,grant_reason)
 values(order_row.store_id,order_row.theme_id,order_row.version_id,order_row.id,auth.uid(),'Đã đối soát chuyển khoản');
end;
$$;

create function public.admin_theme_distribution_stats(themes uuid[])
returns table(id uuid,price_vnd integer,claims bigint,version text) language plpgsql stable security definer set search_path='' as $$
begin
 perform public.theme_admin_required();
 if coalesce(cardinality(themes),0)>20 then raise exception 'too many themes' using errcode='22023'; end if;
 return query select t.id,v.price_vnd,
 (select count(*) from public.storefront_theme_licenses l where l.theme_id=t.id and l.purchase_id is null),v.version
 from public.storefront_template_catalog t join lateral
 (select r.price_vnd,r.version from public.storefront_theme_versions r where r.theme_id=t.id order by r.release_no desc limit 1) v on true
 where t.id=any(themes) and t.lifecycle='published';
end;
$$;
revoke all on function public.admin_theme_distribution_stats(uuid[]) from public,anon,authenticated;
grant execute on function public.admin_theme_distribution_stats(uuid[]) to authenticated;
create view public.admin_theme_marketplace_view with (security_invoker=true) as
 select t.id,v.name,t.theme_slug,v.primary_family,t.lifecycle,v.price_vnd,t.created_at,t.created_by,v.preview_url,t.is_enabled,t.updated_at
 from public.storefront_template_catalog t join lateral (
  select r.name,r.primary_family,r.price_vnd,r.preview_url
  from public.storefront_theme_versions r where r.theme_id=t.id order by r.release_no desc limit 1
 ) v on true where t.lifecycle='published';
revoke all on public.admin_theme_marketplace_view from public,anon,authenticated;
grant select on public.admin_theme_marketplace_view to authenticated;
commit;
