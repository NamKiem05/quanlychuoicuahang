create table public.platform_notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 3 and 160),
  body text not null check (char_length(trim(body)) between 1 and 4000),
  category text not null check (category in ('general', 'maintenance', 'feature', 'payment', 'expiry')),
  audience text not null check (audience in ('all', 'store', 'plan')),
  target_store_id uuid references public.stores(id) on delete set null,
  target_plan text check (target_plan in ('basic', 'plus')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table public.platform_notification_recipients (
  notification_id uuid not null references public.platform_notifications(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  primary key (notification_id, store_id)
);
create index platform_notification_recipients_store_idx on public.platform_notification_recipients(store_id, notification_id);
create table public.platform_notification_reads (
  notification_id uuid not null,
  store_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, store_id, user_id),
  foreign key (notification_id, store_id) references public.platform_notification_recipients(notification_id, store_id) on delete cascade
);
alter table public.platform_notifications enable row level security;
alter table public.platform_notification_recipients enable row level security;
alter table public.platform_notification_reads enable row level security;
revoke all on public.platform_notifications, public.platform_notification_recipients, public.platform_notification_reads from public, anon, authenticated;
grant select on public.platform_notifications, public.platform_notification_recipients, public.platform_notification_reads to authenticated;
create policy platform_notification_recipients_read on public.platform_notification_recipients for select to authenticated using ((select public.is_platform_admin()) or (select public.has_store_role(store_id)));
create policy platform_notifications_read on public.platform_notifications for select to authenticated using ((select public.is_platform_admin()) or exists (select 1 from public.platform_notification_recipients r where r.notification_id = id and public.has_store_role(r.store_id)));
create policy platform_notification_reads_read on public.platform_notification_reads for select to authenticated using (user_id = (select auth.uid()) and (select public.has_store_role(store_id)));

create function public.admin_send_platform_notification(notice_title text, notice_body text, notice_category text, audience_kind text, store_target uuid, plan_target text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid; recipient_count integer;
begin
  if public.is_platform_admin() is not true then raise exception 'not authorized' using errcode = '42501'; end if;
  if char_length(trim(coalesce(notice_title,''))) not between 3 and 160 or char_length(trim(coalesce(notice_body,''))) not between 1 and 4000 or notice_category not in ('general','maintenance','feature','payment','expiry') or audience_kind not in ('all','store','plan') or (audience_kind = 'store' and store_target is null) or (audience_kind = 'plan' and coalesce(plan_target,'') not in ('basic','plus')) then raise exception 'invalid notification' using errcode = '22023'; end if;
  insert into public.platform_notifications(title, body, category, audience, target_store_id, target_plan, created_by)
    values(trim(notice_title), trim(notice_body), notice_category, audience_kind, case when audience_kind = 'store' then store_target end, case when audience_kind = 'plan' then plan_target end, auth.uid()) returning id into result;
  insert into public.platform_notification_recipients(notification_id, store_id)
    select result, s.id from public.stores s
    where audience_kind = 'all' or (audience_kind = 'store' and s.id = store_target) or (audience_kind = 'plan' and s.billing_owner_id is not null and (
      select p.plan from public.merchant_plan_payments p where p.user_id = s.billing_owner_id and p.status = 'approved' and p.valid_until > now()
      order by p.valid_until desc, p.plan desc limit 1
    ) = plan_target);
  get diagnostics recipient_count = row_count;
  if recipient_count = 0 then raise exception 'no matching stores' using errcode = 'P0002'; end if;
  return result;
end; $$;

create function public.mark_platform_notification_read(requested_notice uuid, requested_store uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_store_role(requested_store) or not exists(select 1 from public.platform_notification_recipients where notification_id = requested_notice and store_id = requested_store) then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.platform_notification_reads(notification_id, store_id, user_id) values(requested_notice, requested_store, auth.uid()) on conflict do nothing;
end; $$;

create function public.count_unread_platform_notifications(requested_store uuid)
returns bigint language sql stable security invoker set search_path = '' as $$
  select count(*) from public.platform_notification_recipients r
  where r.store_id = requested_store and public.has_store_role(requested_store)
    and not exists (select 1 from public.platform_notification_reads x where x.notification_id = r.notification_id and x.store_id = r.store_id and x.user_id = auth.uid());
$$;
revoke all on function public.admin_send_platform_notification(text,text,text,text,uuid,text), public.mark_platform_notification_read(uuid,uuid), public.count_unread_platform_notifications(uuid) from public, anon, authenticated;
grant execute on function public.admin_send_platform_notification(text,text,text,text,uuid,text), public.mark_platform_notification_read(uuid,uuid), public.count_unread_platform_notifications(uuid) to authenticated;
