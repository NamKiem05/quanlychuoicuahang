create table public.store_admin_messages (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  sender_role text not null check (sender_role in ('merchant', 'admin')),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index store_admin_messages_store_created_idx
  on public.store_admin_messages (store_id, created_at desc, id desc);

alter table public.store_admin_messages enable row level security;

create policy store_admin_messages_read_related
  on public.store_admin_messages
  for select
  to authenticated
  using (
    (select public.has_store_role(store_id))
    or (select public.is_platform_admin())
  );

revoke all privileges on public.store_admin_messages from anon, authenticated;
grant select on public.store_admin_messages to authenticated;

create function public.send_store_admin_message(
  requested_store_id uuid,
  requested_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender_id uuid := auth.uid();
  v_sender_role text;
  v_body text := btrim(coalesce(requested_body, ''));
  v_message public.store_admin_messages%rowtype;
begin
  if v_sender_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'invalid message length' using errcode = '22023';
  end if;

  if (select public.is_platform_admin()) then
    v_sender_role := 'admin';
  elsif (select public.has_store_role(requested_store_id)) then
    v_sender_role := 'merchant';
  else
    raise exception 'not authorized for this store conversation' using errcode = '42501';
  end if;

  insert into public.store_admin_messages (store_id, sender_id, sender_role, body)
  values (requested_store_id, v_sender_id, v_sender_role, v_body)
  returning * into v_message;

  return jsonb_build_object(
    'id', v_message.id,
    'store_id', v_message.store_id,
    'sender_id', v_message.sender_id,
    'sender_role', v_message.sender_role,
    'body', v_message.body,
    'created_at', v_message.created_at
  );
end;
$$;

revoke all on function public.send_store_admin_message(uuid, text) from public, anon;
grant execute on function public.send_store_admin_message(uuid, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'store_admin_messages'
    ) then
    alter publication supabase_realtime add table public.store_admin_messages;
  end if;
end;
$$;
