-- Invitations add only the existing staff role. The recipient must accept with
-- a verified matching account; no email is sent by this migration.
create table public.store_staff_invitations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  email text not null check (length(email) between 3 and 254),
  status text not null default 'pending' check (status in ('pending','accepted','declined','revoked','expired')),
  invited_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  responded_at timestamptz
);
create unique index store_staff_pending_email_idx on public.store_staff_invitations(store_id, lower(email)) where status = 'pending';
create index store_staff_invitations_email_idx on public.store_staff_invitations(lower(email), status);
alter table public.store_staff_invitations enable row level security;
revoke all on public.store_staff_invitations from public, anon, authenticated;
grant select on public.store_staff_invitations to authenticated;
create policy store_staff_invites_owner_read on public.store_staff_invitations for select to authenticated using (public.has_store_role(store_id, array['owner']::public.store_member_role[]));

-- Mutations go through checked functions rather than broad direct membership grants.
revoke insert, update, delete on public.store_members from authenticated;

create function public.owner_store_staff_list(target_store uuid)
returns table(user_id uuid, role public.store_member_role, joined_at timestamptz, email text, display_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_store_role(target_store, array['owner']::public.store_member_role[]) then raise exception 'not authorized' using errcode = '42501'; end if;
  return query select m.user_id, m.role, m.created_at, u.email::text, coalesce(nullif(p.display_name,''), u.raw_user_meta_data->>'display_name', '')
    from public.store_members m join auth.users u on u.id = m.user_id left join public.profiles p on p.id = m.user_id
    where m.store_id = target_store order by m.created_at, m.user_id;
end;
$$;

create function public.owner_invite_store_staff(target_store uuid, target_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare normalized text := lower(trim(coalesce(target_email,'')));
begin
  if not public.has_store_role(target_store, array['owner']::public.store_member_role[]) then raise exception 'not authorized' using errcode = '42501'; end if;
  if length(normalized) > 254 or normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'invalid email' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_store::text, 173));
  if exists(select 1 from public.store_members m join auth.users u on u.id = m.user_id where m.store_id = target_store and lower(u.email) = normalized) then raise exception 'already a member' using errcode = '23505'; end if;
  update public.store_staff_invitations set status = 'expired' where store_id = target_store and lower(email) = normalized and status = 'pending' and expires_at <= now();
  insert into public.store_staff_invitations(store_id, email, invited_by) values(target_store, normalized, auth.uid());
end;
$$;

create function public.owner_revoke_store_staff(target_store uuid, target_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_store_role(target_store, array['owner']::public.store_member_role[]) then raise exception 'not authorized' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_store::text, 173));
  delete from public.store_members where store_id = target_store and user_id = target_user and role = 'staff';
  if not found then raise exception 'staff not found' using errcode = 'P0002'; end if;
  update public.store_staff_invitations set status = 'revoked', responded_at = now() where store_id = target_store and status = 'pending' and lower(email) = (select lower(u.email) from auth.users u where u.id = target_user);
end;
$$;

create function public.owner_cancel_staff_invite(target_store uuid, invite_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_store_role(target_store, array['owner']::public.store_member_role[]) then raise exception 'not authorized' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_store::text, 173));
  update public.store_staff_invitations set status = 'revoked', responded_at = now() where id = invite_id and store_id = target_store and status = 'pending';
  if not found then raise exception 'invitation not found' using errcode = 'P0002'; end if;
end;
$$;

create function public.my_store_staff_invitations()
returns table(id uuid, store_name text, store_slug text, created_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.id, s.name, s.slug, i.created_at, i.expires_at
  from public.store_staff_invitations i join public.stores s on s.id = i.store_id join auth.users u on u.id = auth.uid()
  where u.email_confirmed_at is not null and lower(u.email) = lower(i.email) and i.status = 'pending' and i.expires_at > now()
    and not public.is_dedicated_platform_account(u.id)
  order by i.created_at desc, i.id;
$$;

create function public.respond_store_staff_invitation(invite_id uuid, accept_invitation boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare invitation public.store_staff_invitations%rowtype; user_email text; target_store uuid;
begin
  if auth.uid() is null or accept_invitation is null or public.is_dedicated_platform_account(auth.uid()) then raise exception 'not authorized' using errcode = '42501'; end if;
  select lower(email) into user_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  select store_id into target_store from public.store_staff_invitations where id = invite_id;
  if target_store is null then raise exception 'invitation unavailable' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_store::text, 173));
  select * into invitation from public.store_staff_invitations where id = invite_id for update;
  if not found or user_email is null or user_email <> lower(invitation.email) or invitation.status <> 'pending' or invitation.expires_at <= now() then raise exception 'invitation unavailable' using errcode = '22023'; end if;
  if accept_invitation then
    insert into public.store_members(store_id, user_id, role) values(invitation.store_id, auth.uid(), 'staff') on conflict (store_id, user_id) do nothing;
  end if;
  update public.store_staff_invitations set status = case when accept_invitation then 'accepted' else 'declined' end, responded_at = now() where id = invite_id;
end;
$$;
revoke all on function public.owner_store_staff_list(uuid), public.owner_invite_store_staff(uuid,text), public.owner_revoke_store_staff(uuid,uuid), public.owner_cancel_staff_invite(uuid,uuid), public.my_store_staff_invitations(), public.respond_store_staff_invitation(uuid,boolean) from public, anon, authenticated;
grant execute on function public.owner_store_staff_list(uuid), public.owner_invite_store_staff(uuid,text), public.owner_revoke_store_staff(uuid,uuid), public.owner_cancel_staff_invite(uuid,uuid), public.my_store_staff_invitations(), public.respond_store_staff_invitation(uuid,boolean) to authenticated;
