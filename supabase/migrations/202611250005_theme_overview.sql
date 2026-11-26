-- Existing installations have no reliable creation timestamp. Keep it unknown.
alter table public.storefront_store_theme add column installed_at timestamptz;
alter table public.storefront_store_theme alter column installed_at set default now();
alter table public.storefront_store_theme add column installed_by uuid references auth.users(id) on delete set null;
alter table public.storefront_store_theme alter column installed_by set default auth.uid();

create index storefront_theme_orders_created on public.storefront_theme_purchases(created_at);
create index storefront_theme_orders_confirmed on public.storefront_theme_purchases(confirmed_at) where confirmed_at is not null;

create function public.admin_theme_overview_report(start_day date, end_day date, grain text, sort_by text, page_offset integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  since timestamptz := start_day::timestamp at time zone 'Asia/Ho_Chi_Minh';
  until_at timestamptz := end_day::timestamp at time zone 'Asia/Ho_Chi_Minh';
  stride interval;
begin
  perform public.theme_admin_required();
  if start_day is null or end_day is null or end_day - start_day not between 1 and 366
    or grain is null or grain not in ('day','week','month')
    or sort_by is null or sort_by not in ('purchases','installations','revenue')
    or page_offset is null or page_offset not between 0 and 1000000 then
    raise exception 'invalid theme report filters' using errcode = '22023';
  end if;
  stride := case grain when 'day' then interval '1 day' when 'week' then interval '1 week' else interval '1 month' end;

  return (
    with themes as (
      select t.id, t.name, t.primary_family, t.preview_url, t.lifecycle, t.created_at, t.created_by,
        v.version, t.lifecycle = 'published' and t.is_enabled and v.version is not null
          and (select marketplace_open from public.storefront_theme_policy where id) as listed
      from public.storefront_template_catalog t
      left join lateral (
        select version from public.storefront_theme_versions where theme_id = t.id order by release_no desc limit 1
      ) v on true
    ), installs as (
      select a.theme_id, a.store_id, a.installed_at, a.installed_by, a.is_active,
        a.is_active and s.status = 'active' and l.revoked_at is null
          and coalesce(c.theme_family, 'general') = any(v.families) as in_use
      from public.storefront_store_theme a
      join public.stores s on s.id = a.store_id
      left join public.business_categories c on c.id = s.business_category_id
      join public.storefront_theme_licenses l on (l.store_id,l.theme_id) = (a.store_id,a.theme_id)
      join public.storefront_theme_versions v on v.id = a.version_id
    ), install_totals as (
      select theme_id, count(*) filter (where installed_at >= since and installed_at < until_at) as installations,
        count(*) filter (where in_use) as stores
      from installs group by theme_id
    ), orders as (
      select id, theme_id, store_id, amount_vnd, created_at, created_by, confirmed_at, confirmed_by
      from public.storefront_theme_purchases
      where (created_at >= since and created_at < until_at) or (confirmed_at >= since and confirmed_at < until_at)
    ), order_totals as (
      select theme_id, count(*) filter (where confirmed_at >= since and confirmed_at < until_at) as purchases,
        coalesce(sum(amount_vnd) filter (where confirmed_at >= since and confirmed_at < until_at), 0) as revenue
      from orders group by theme_id
    ), ranked as (
      select t.id,t.name,t.primary_family,t.preview_url,t.lifecycle,t.version,t.listed,
        coalesce(i.installations,0) as installations, coalesce(i.stores,0) as stores,
        coalesce(o.purchases,0) as purchases, coalesce(o.revenue,0) as revenue
      from themes t left join install_totals i on i.theme_id = t.id left join order_totals o on o.theme_id = t.id
      order by case sort_by when 'purchases' then coalesce(o.purchases,0)
        when 'revenue' then coalesce(o.revenue,0) else coalesce(i.installations,0) end desc, t.name,t.id
      limit 10 offset page_offset
    ), series_events as (
      select created_at as at, 1 as orders, 0 as paid, 0 as revenue, 0 as installations from orders
      union all select confirmed_at,0,1,amount_vnd,0 from orders where confirmed_at is not null
      union all select installed_at,0,0,0,1 from installs where installed_at >= since and installed_at < until_at
    ), series_totals as (
      select date_trunc(grain, at at time zone 'Asia/Ho_Chi_Minh') as bucket,
        sum(orders) as orders,sum(paid) as paid,sum(revenue) as revenue,sum(installations) as installations
      from series_events where at >= since and at < until_at group by 1
    ), buckets as (
      select generate_series(date_trunc(grain,start_day::timestamp),
        date_trunc(grain,(end_day - 1)::timestamp),stride) as bucket
    ), events as (
      select t.created_at as at, 'created' as kind,t.id as theme_id,null::uuid as store_id,t.created_by as actor,t.id as event_id from themes t
      union all select v.published_at, case when exists (
        select 1 from public.storefront_theme_versions earlier where earlier.theme_id=v.theme_id and earlier.release_no<v.release_no
      ) then 'updated' else 'published' end,v.theme_id,null,v.published_by,v.id
        from public.storefront_theme_versions v where v.published_at >= since and v.published_at < until_at
      union all select l.granted_at,case when l.purchase_id is null and l.granted_by is null then 'claimed' else 'granted' end,
        l.theme_id,l.store_id,coalesce(l.granted_by,p.confirmed_by),l.store_id
        from public.storefront_theme_licenses l left join orders p on p.id=l.purchase_id
        where l.granted_at >= since and l.granted_at < until_at
      union all select revoked_at,'revoked',theme_id,store_id,revoked_by,store_id from public.storefront_theme_licenses where revoked_at >= since and revoked_at < until_at
      union all select created_at,'ordered',theme_id,store_id,created_by,id from orders
      union all select confirmed_at,'paid',theme_id,store_id,confirmed_by,id from orders
      union all select installed_at,'installed',theme_id,store_id,installed_by,store_id from installs where installed_at >= since and installed_at < until_at
    ), recent as (
      select * from events where at >= since and at < until_at
      order by at desc,kind,event_id,theme_id limit 15
    )
    select jsonb_build_object(
      'catalog', (select jsonb_build_object('total',count(*),'draft',count(*) filter (where lifecycle='draft'),
        'published',count(*) filter (where lifecycle='published'),'archived',count(*) filter (where lifecycle='archived'),
        'listed',count(*) filter (where listed),'paused',count(*) filter (where lifecycle='published' and listed is not true)) from themes),
      'installation', (select jsonb_build_object('total',count(*),'active',count(*) filter (where is_active),
        'inactive',count(*) filter (where not is_active),'unknown_date',count(*) filter (where installed_at is null),
        'stores',count(distinct store_id) filter (where in_use),
        'new_stores',(select count(*) from (
          select store_id from installs group by store_id
          having count(*) filter (where installed_at is null)=0 and min(installed_at)>=since and min(installed_at)<until_at
        ) first_install)) from installs),
      'licenses', (select jsonb_build_object('total',count(*),'active',count(*) filter (where revoked_at is null),
        'revoked',count(*) filter (where revoked_at is not null)) from public.storefront_theme_licenses),
      'orders', (select jsonb_build_object('total',count(*) filter (where created_at >= since and created_at < until_at),
        'pending',count(*) filter (where created_at >= since and created_at < until_at and confirmed_at is null),
        'paid_orders',count(*) filter (where created_at >= since and created_at < until_at and confirmed_at is not null),
        'paid',count(*) filter (where confirmed_at >= since and confirmed_at < until_at),
        'value',coalesce(sum(amount_vnd) filter (where created_at >= since and created_at < until_at),0),
        'received',coalesce(sum(amount_vnd) filter (where confirmed_at >= since and confirmed_at < until_at),0)) from orders),
      'queue', jsonb_build_object(
        'pending',(select count(*) from public.storefront_theme_purchases where confirmed_at is null),
        'missing_license',(select count(*) from public.storefront_theme_purchases p where p.confirmed_at is not null
          and not exists (select 1 from public.storefront_theme_licenses l where l.purchase_id=p.id)),
        'support',(select count(*) from public.support_tickets where category='website' and status in ('open','in_progress'))),
      'series', (select jsonb_agg(jsonb_build_object('date',b.bucket::date,'orders',coalesce(s.orders,0),
        'paid',coalesce(s.paid,0),'revenue',coalesce(s.revenue,0),'installations',coalesce(s.installations,0)) order by b.bucket)
        from buckets b left join series_totals s using(bucket)),
      'top_installations', coalesce((select jsonb_agg(to_jsonb(d) order by d.installations desc,d.name,d.id) from (
        select t.id,t.name,i.installations from install_totals i join themes t on t.id=i.theme_id
        where i.installations>0 order by i.installations desc,t.name,t.id limit 8
      ) d),'[]'::jsonb),
      'ranking', coalesce((select jsonb_agg(to_jsonb(r) order by case sort_by when 'purchases' then r.purchases
        when 'revenue' then r.revenue else r.installations end desc,r.name,r.id) from ranked r),'[]'::jsonb),
      'activity', coalesce((select jsonb_agg(jsonb_build_object('at',e.at,'kind',e.kind,'theme',t.name,
        'store',s.name,'actor',coalesce(nullif(btrim(p.display_name),''), case when e.actor is not null then 'Tài khoản ' || left(e.actor::text,8) end))
        order by e.at desc,e.kind,e.event_id,e.theme_id) from recent e join themes t on t.id=e.theme_id
        left join public.stores s on s.id=e.store_id left join public.profiles p on p.id=e.actor),'[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.admin_theme_overview_report(date,date,text,text,integer) from public, anon, authenticated;
grant execute on function public.admin_theme_overview_report(date,date,text,text,integer) to authenticated;
