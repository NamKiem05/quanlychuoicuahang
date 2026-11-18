create table public.store_chat_assignments (
  store_id uuid primary key references public.stores(id) on delete cascade,
  assigned_to uuid references auth.users(id) on delete set null,
  assigned_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table public.store_chat_assignment_history (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  assigned_to uuid references auth.users(id) on delete set null,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.store_chat_assignments enable row level security;
alter table public.store_chat_assignment_history enable row level security;
revoke all on public.store_chat_assignments, public.store_chat_assignment_history from public, anon, authenticated;
grant select on public.store_chat_assignments, public.store_chat_assignment_history to authenticated;
create policy chat_assignments_admin_read on public.store_chat_assignments for select to authenticated using ((select public.is_platform_admin()));
create policy chat_assignment_history_admin_read on public.store_chat_assignment_history for select to authenticated using ((select public.is_platform_admin()));

create function public.assign_store_chat(target_store uuid, assignee uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.is_platform_admin() is not true then raise exception 'not authorized' using errcode = '42501'; end if;
  if not exists(select 1 from public.stores where id = target_store) or (assignee is not null and not exists(select 1 from public.platform_admins where user_id = assignee)) then raise exception 'invalid assignment' using errcode = '22023'; end if;
  insert into public.store_chat_assignments(store_id, assigned_to, assigned_by) values(target_store, assignee, auth.uid())
    on conflict(store_id) do update set assigned_to = excluded.assigned_to, assigned_by = excluded.assigned_by, updated_at = now();
  insert into public.store_chat_assignment_history(store_id, assigned_to, assigned_by) values(target_store, assignee, auth.uid());
end; $$;
revoke all on function public.assign_store_chat(uuid, uuid) from public, anon, authenticated;
grant execute on function public.assign_store_chat(uuid, uuid) to authenticated;

alter table public.store_admin_messages add column attachment_path text unique, add column attachment_name text;
alter table public.store_admin_messages add constraint chat_attachment_pair_check check ((attachment_path is null and attachment_name is null) or (attachment_path is not null and char_length(attachment_name) between 1 and 150));
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('store-chat-files', 'store-chat-files', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf','text/plain'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy store_chat_files_read on storage.objects for select to authenticated using (bucket_id = 'store-chat-files' and exists(select 1 from public.stores s where s.id::text = (storage.foldername(name))[1] and (public.is_platform_admin() or public.has_store_role(s.id))));
create policy store_chat_files_insert on storage.objects for insert to authenticated with check (bucket_id = 'store-chat-files' and exists(select 1 from public.stores s where s.id::text = (storage.foldername(name))[1] and (public.is_platform_admin() or public.has_store_role(s.id))));
create policy store_chat_files_delete_own on storage.objects for delete to authenticated using (bucket_id = 'store-chat-files' and owner_id = auth.uid()::text and not exists(select 1 from public.store_admin_messages m where m.attachment_path = name));

create function public.send_store_chat_attachment(target_store uuid, path text, filename text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.store_admin_messages%rowtype; actor uuid := auth.uid(); role_name text;
begin
  if actor is null or not (public.is_platform_admin() or public.has_store_role(target_store)) then raise exception 'not authorized' using errcode = '42501'; end if;
  if char_length(trim(coalesce(filename,''))) not between 1 and 150 or path !~ ('^' || target_store::text || '/[a-f0-9-]{36}$') or not exists (select 1 from storage.objects o where o.bucket_id = 'store-chat-files' and o.name = path and o.owner_id = actor::text) then raise exception 'invalid attachment' using errcode = '22023'; end if;
  role_name := case when public.is_platform_admin() then 'admin' else 'merchant' end;
  insert into public.store_admin_messages(store_id, sender_id, sender_role, body, attachment_path, attachment_name)
  values(target_store, actor, role_name, 'Tệp đính kèm: ' || trim(filename), path, trim(filename)) returning * into m;
  return to_jsonb(m);
end; $$;
revoke all on function public.send_store_chat_attachment(uuid,text,text) from public, anon, authenticated;
grant execute on function public.send_store_chat_attachment(uuid,text,text) to authenticated;

create table public.store_chat_presence (
  store_id uuid primary key references public.stores(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);
alter table public.store_chat_presence enable row level security;
revoke all on public.store_chat_presence from public, anon, authenticated;
grant select on public.store_chat_presence to authenticated;
create policy chat_presence_admin_read on public.store_chat_presence for select to authenticated using ((select public.is_platform_admin()));
create function public.heartbeat_store_chat(target_store uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_store_role(target_store) then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.store_chat_presence(store_id, last_seen_at) values(target_store, now())
  on conflict(store_id) do update set last_seen_at = excluded.last_seen_at;
end; $$;
revoke all on function public.heartbeat_store_chat(uuid) from public, anon, authenticated;
grant execute on function public.heartbeat_store_chat(uuid) to authenticated;
