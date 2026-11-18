create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  created_by uuid not null references auth.users(id),
  subject text not null check (char_length(trim(subject)) between 3 and 160),
  category text not null check (category in ('account','billing','website','orders','other')),
  status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  assigned_to uuid references auth.users(id),
  rating smallint check (rating between 1 and 5),
  rating_note text check (char_length(rating_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  first_response_at timestamptz,
  resolved_at timestamptz
);
create index support_tickets_store_created_idx on public.support_tickets(store_id, created_at desc);
create index support_tickets_status_created_idx on public.support_tickets(status, created_at desc);
create table public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  author_role text not null check (author_role in ('admin','merchant')),
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index support_ticket_messages_ticket_idx on public.support_ticket_messages(ticket_id, created_at, id);
alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;
revoke all on public.support_tickets, public.support_ticket_messages from public, anon, authenticated;
grant select on public.support_tickets, public.support_ticket_messages to authenticated;
create policy support_tickets_read on public.support_tickets for select to authenticated using ((select public.is_platform_admin()) or (select public.has_store_role(store_id)));
create policy support_messages_read on public.support_ticket_messages for select to authenticated using (exists (select 1 from public.support_tickets t where t.id = ticket_id and ((select public.is_platform_admin()) or public.has_store_role(t.store_id))));

create function public.create_support_ticket(target_store uuid, title text, kind text, message text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare tid uuid; actor uuid := auth.uid(); role_name text;
begin
  if actor is null or not (public.is_platform_admin() or public.has_store_role(target_store)) then raise exception 'not authorized' using errcode = '42501'; end if;
  if char_length(trim(coalesce(title, ''))) not between 3 and 160 or char_length(trim(coalesce(message, ''))) not between 1 and 4000 or kind not in ('account','billing','website','orders','other') then raise exception 'invalid ticket' using errcode = '22023'; end if;
  role_name := case when public.is_platform_admin() then 'admin' else 'merchant' end;
  insert into public.support_tickets(store_id, created_by, subject, category) values (target_store, actor, trim(title), kind) returning id into tid;
  insert into public.support_ticket_messages(ticket_id, author_id, author_role, body) values (tid, actor, role_name, trim(message));
  return tid;
end; $$;

create function public.reply_support_ticket(target_ticket uuid, message text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.support_tickets%rowtype; role_name text;
begin
  select * into t from public.support_tickets where id = target_ticket for update;
  if not found or auth.uid() is null or not (public.is_platform_admin() or public.has_store_role(t.store_id)) then raise exception 'not authorized' using errcode = '42501'; end if;
  if t.status in ('resolved','closed') or char_length(trim(coalesce(message, ''))) not between 1 and 4000 then raise exception 'invalid message or closed ticket' using errcode = '22023'; end if;
  role_name := case when public.is_platform_admin() then 'admin' else 'merchant' end;
  insert into public.support_ticket_messages(ticket_id, author_id, author_role, body) values (t.id, auth.uid(), role_name, trim(message));
  update public.support_tickets set updated_at = now(), first_response_at = case when role_name = 'admin' then coalesce(first_response_at, now()) else first_response_at end where id = t.id;
end; $$;

create function public.admin_update_support_ticket(target_ticket uuid, next_status text, next_category text, assignee uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.is_platform_admin() is not true then raise exception 'not authorized' using errcode = '42501'; end if;
  if next_status not in ('open','in_progress','resolved','closed') or next_category not in ('account','billing','website','orders','other') or (assignee is not null and not exists(select 1 from public.platform_admins where user_id = assignee)) then raise exception 'invalid ticket update' using errcode = '22023'; end if;
  update public.support_tickets set status = next_status, category = next_category, assigned_to = assignee, updated_at = now(),
    resolved_at = case when next_status in ('resolved','closed') then coalesce(resolved_at, now()) else null end,
    rating = case when next_status in ('open','in_progress') then null else rating end,
    rating_note = case when next_status in ('open','in_progress') then null else rating_note end
  where id = target_ticket;
  if not found then raise exception 'ticket not found' using errcode = 'P0002'; end if;
end; $$;

create function public.rate_support_ticket(target_ticket uuid, stars integer, note text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.support_tickets%rowtype;
begin
  select * into t from public.support_tickets where id = target_ticket for update;
  if not found or auth.uid() is null or not public.has_store_role(t.store_id, array['owner']::public.store_member_role[]) then raise exception 'not authorized' using errcode = '42501'; end if;
  if t.status not in ('resolved','closed') or stars is null or stars not between 1 and 5 or char_length(coalesce(note,'')) > 500 then raise exception 'invalid rating' using errcode = '22023'; end if;
  update public.support_tickets set rating = stars, rating_note = nullif(trim(note), ''), updated_at = now() where id = t.id;
end; $$;
revoke all on function public.create_support_ticket(uuid,text,text,text), public.reply_support_ticket(uuid,text), public.admin_update_support_ticket(uuid,text,text,uuid), public.rate_support_ticket(uuid,integer,text) from public, anon, authenticated;
grant execute on function public.create_support_ticket(uuid,text,text,text), public.reply_support_ticket(uuid,text), public.admin_update_support_ticket(uuid,text,text,uuid), public.rate_support_ticket(uuid,integer,text) to authenticated;

create table public.support_ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id),
  object_path text not null unique,
  original_name text not null check (char_length(original_name) between 1 and 150),
  created_at timestamptz not null default now()
);
alter table public.support_ticket_attachments enable row level security;
revoke all on public.support_ticket_attachments from public, anon, authenticated;
grant select on public.support_ticket_attachments to authenticated;
create policy support_attachments_read on public.support_ticket_attachments for select to authenticated using (exists (select 1 from public.support_tickets t where t.id = ticket_id and (public.is_platform_admin() or public.has_store_role(t.store_id))));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-ticket-files', 'support-ticket-files', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf','text/plain'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy support_ticket_files_read on storage.objects for select to authenticated using (
  bucket_id = 'support-ticket-files' and exists (select 1 from public.support_tickets t where t.id::text = (storage.foldername(name))[1] and (public.is_platform_admin() or public.has_store_role(t.store_id)))
);
create policy support_ticket_files_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'support-ticket-files' and exists (select 1 from public.support_tickets t where t.id::text = (storage.foldername(name))[1] and t.status in ('open','in_progress') and (public.is_platform_admin() or public.has_store_role(t.store_id)))
);
create policy support_ticket_files_delete_own on storage.objects for delete to authenticated using (bucket_id = 'support-ticket-files' and owner_id = auth.uid()::text and not exists (select 1 from public.support_ticket_attachments a where a.object_path = name));

create function public.add_support_ticket_attachment(target_ticket uuid, path text, filename text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.support_tickets%rowtype;
begin
  select * into t from public.support_tickets where id = target_ticket for update;
  if not found or auth.uid() is null or not (public.is_platform_admin() or public.has_store_role(t.store_id)) then raise exception 'not authorized' using errcode = '42501'; end if;
  if t.status not in ('open','in_progress') or char_length(trim(coalesce(filename,''))) not between 1 and 150 or path !~ ('^' || t.id::text || '/[a-f0-9-]{36}$') or not exists (select 1 from storage.objects o where o.bucket_id = 'support-ticket-files' and o.name = path and o.owner_id = auth.uid()::text) then raise exception 'invalid attachment' using errcode = '22023'; end if;
  insert into public.support_ticket_attachments(ticket_id, uploaded_by, object_path, original_name) values (t.id, auth.uid(), path, trim(filename));
  update public.support_tickets set updated_at = now() where id = t.id;
end; $$;
revoke all on function public.add_support_ticket_attachment(uuid,text,text) from public, anon, authenticated;
grant execute on function public.add_support_ticket_attachment(uuid,text,text) to authenticated;
