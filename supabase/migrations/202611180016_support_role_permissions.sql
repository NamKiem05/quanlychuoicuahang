-- First scoped role: support tickets only. Existing platform_admins remain full admins.
create table public.platform_staff_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role_code text not null references public.platform_role_catalog(code),
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now()
);
create table public.platform_staff_role_audit (
  id uuid primary key default gen_random_uuid(),
  target_user uuid not null references auth.users(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  old_role text,
  new_role text,
  occurred_at timestamptz not null default now()
);
alter table public.platform_staff_roles enable row level security;
alter table public.platform_staff_role_audit enable row level security;
revoke all on public.platform_staff_roles, public.platform_staff_role_audit from public, anon, authenticated;
grant select on public.platform_staff_roles, public.platform_staff_role_audit to authenticated;
create policy staff_roles_admin_read on public.platform_staff_roles for select to authenticated using ((select public.is_platform_admin()));
create policy staff_roles_self_read on public.platform_staff_roles for select to authenticated using (user_id = (select auth.uid()));
create policy staff_role_audit_admin_read on public.platform_staff_role_audit for select to authenticated using ((select public.is_platform_admin()));

create function public.has_support_ticket_permission()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or exists (
    select 1 from public.platform_staff_roles r where r.user_id = auth.uid() and r.role_code = 'support_admin'
  );
$$;
create function public.assign_support_staff_role(target_user uuid, enable_role boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare previous text;
begin
  if public.is_platform_admin() is not true then raise exception 'not authorized' using errcode = '42501'; end if;
  if target_user is null or enable_role is null or not public.is_dedicated_platform_account(target_user) then raise exception 'invalid staff account' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_user::text, 4381));
  if exists (select 1 from public.platform_admins where user_id = target_user) then raise exception 'account has full admin access' using errcode = '22023'; end if;
  select role_code into previous from public.platform_staff_roles where user_id = target_user;
  if enable_role then
    insert into public.platform_staff_roles(user_id, role_code, granted_by) values(target_user, 'support_admin', auth.uid())
      on conflict(user_id) do update set role_code = excluded.role_code, granted_by = excluded.granted_by, granted_at = now();
  else
    delete from public.platform_staff_roles where user_id = target_user;
  end if;
  insert into public.platform_staff_role_audit(target_user, actor_id, old_role, new_role) values(target_user, auth.uid(), previous, case when enable_role then 'support_admin' end);
end; $$;

-- Never silently combine a scoped role with unrestricted admin access.
create function public.guard_full_admin_against_scoped_role()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 4381));
  if exists(select 1 from public.platform_staff_roles where user_id = new.user_id) then raise exception 'scoped_role_must_be_removed' using errcode = '22023'; end if;
  return new;
end; $$;
revoke all on function public.guard_full_admin_against_scoped_role() from public, anon, authenticated;
create trigger full_admin_guard_scoped_role before insert or update of user_id on public.platform_admins for each row execute function public.guard_full_admin_against_scoped_role();

-- Store options are exposed via a limited RPC; no broad stores-table grant.
create policy support_tickets_scoped_read on public.support_tickets for select to authenticated using ((select public.has_support_ticket_permission()));
create policy support_ticket_messages_scoped_read on public.support_ticket_messages for select to authenticated using ((select public.has_support_ticket_permission()));
create policy support_ticket_attachments_scoped_read on public.support_ticket_attachments for select to authenticated using ((select public.has_support_ticket_permission()));
create policy support_ticket_files_scoped_read on storage.objects for select to authenticated using (
  bucket_id = 'support-ticket-files' and (select public.has_support_ticket_permission()) and exists (select 1 from public.support_tickets t where t.id::text = (storage.foldername(name))[1])
);
create policy support_ticket_files_scoped_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'support-ticket-files' and (select public.has_support_ticket_permission()) and exists (select 1 from public.support_tickets t where t.id::text = (storage.foldername(name))[1] and t.status in ('open','in_progress'))
);

create or replace function public.create_support_ticket(target_store uuid, title text, kind text, message text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare tid uuid; actor uuid := auth.uid(); role_name text;
begin
  if actor is null or not (public.has_support_ticket_permission() or public.has_store_role(target_store)) then raise exception 'not authorized' using errcode = '42501'; end if;
  if char_length(trim(coalesce(title, ''))) not between 3 and 160 or char_length(trim(coalesce(message, ''))) not between 1 and 4000 or kind not in ('account','billing','website','orders','other') then raise exception 'invalid ticket' using errcode = '22023'; end if;
  role_name := case when public.has_support_ticket_permission() then 'admin' else 'merchant' end;
  insert into public.support_tickets(store_id, created_by, subject, category) values (target_store, actor, trim(title), kind) returning id into tid;
  insert into public.support_ticket_messages(ticket_id, author_id, author_role, body) values (tid, actor, role_name, trim(message));
  return tid;
end; $$;
create or replace function public.reply_support_ticket(target_ticket uuid, message text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.support_tickets%rowtype; role_name text;
begin
  select * into t from public.support_tickets where id = target_ticket for update;
  if not found or auth.uid() is null or not (public.has_support_ticket_permission() or public.has_store_role(t.store_id)) then raise exception 'not authorized' using errcode = '42501'; end if;
  if t.status in ('resolved','closed') or char_length(trim(coalesce(message, ''))) not between 1 and 4000 then raise exception 'invalid message or closed ticket' using errcode = '22023'; end if;
  role_name := case when public.has_support_ticket_permission() then 'admin' else 'merchant' end;
  insert into public.support_ticket_messages(ticket_id, author_id, author_role, body) values (t.id, auth.uid(), role_name, trim(message));
  update public.support_tickets set updated_at = now(), first_response_at = case when role_name = 'admin' then coalesce(first_response_at, now()) else first_response_at end where id = t.id;
end; $$;
create or replace function public.admin_update_support_ticket(target_ticket uuid, next_status text, next_category text, assignee uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.has_support_ticket_permission() is not true then raise exception 'not authorized' using errcode = '42501'; end if;
  if next_status not in ('open','in_progress','resolved','closed') or next_category not in ('account','billing','website','orders','other') or (assignee is not null and not exists(select 1 from public.platform_admins where user_id = assignee) and not exists(select 1 from public.platform_staff_roles where user_id = assignee and role_code = 'support_admin')) then raise exception 'invalid ticket update' using errcode = '22023'; end if;
  update public.support_tickets set status = next_status, category = next_category, assigned_to = assignee, updated_at = now(),
    resolved_at = case when next_status in ('resolved','closed') then coalesce(resolved_at, now()) else null end,
    rating = case when next_status in ('open','in_progress') then null else rating end,
    rating_note = case when next_status in ('open','in_progress') then null else rating_note end
  where id = target_ticket;
  if not found then raise exception 'ticket not found' using errcode = 'P0002'; end if;
end; $$;
create or replace function public.add_support_ticket_attachment(target_ticket uuid, path text, filename text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.support_tickets%rowtype;
begin
  select * into t from public.support_tickets where id = target_ticket for update;
  if not found or auth.uid() is null or not (public.has_support_ticket_permission() or public.has_store_role(t.store_id)) then raise exception 'not authorized' using errcode = '42501'; end if;
  if t.status not in ('open','in_progress') or char_length(trim(coalesce(filename,''))) not between 1 and 150 or path !~ ('^' || t.id::text || '/[a-f0-9-]{36}$') or not exists (select 1 from storage.objects o where o.bucket_id = 'support-ticket-files' and o.name = path and o.owner_id = auth.uid()::text) then raise exception 'invalid attachment' using errcode = '22023'; end if;
  insert into public.support_ticket_attachments(ticket_id, uploaded_by, object_path, original_name) values (t.id, auth.uid(), path, trim(filename));
  update public.support_tickets set updated_at = now() where id = t.id;
end; $$;

create function public.get_support_staff()
returns table(user_id uuid, display_name text) language sql stable security definer set search_path = '' as $$
  select a.user_id, coalesce(nullif(p.display_name, ''), 'Admin ' || left(a.user_id::text, 8)) from public.platform_admins a left join public.profiles p on p.id = a.user_id where public.has_support_ticket_permission()
  union
  select r.user_id, coalesce(nullif(p.display_name, ''), 'Hỗ trợ ' || left(r.user_id::text, 8)) from public.platform_staff_roles r left join public.profiles p on p.id = r.user_id where r.role_code = 'support_admin' and public.has_support_ticket_permission();
$$;
create function public.get_support_store_options()
returns table(id uuid, name text) language sql stable security definer set search_path = '' as $$
  select s.id, s.name from public.stores s where public.has_support_ticket_permission() order by s.name, s.id;
$$;
revoke all on function public.has_support_ticket_permission(), public.assign_support_staff_role(uuid,boolean), public.get_support_staff(), public.get_support_store_options() from public, anon, authenticated;
grant execute on function public.has_support_ticket_permission(), public.assign_support_staff_role(uuid,boolean), public.get_support_staff(), public.get_support_store_options() to authenticated;
