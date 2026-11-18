create table public.platform_staff_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (length(email) between 3 and 254),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending','processing','accepted','revoked')),
  invited_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_user_id uuid references auth.users(id),
  accepted_at timestamptz
);
create unique index platform_staff_invitation_pending_email on public.platform_staff_invitations(lower(email)) where status in ('pending','processing');
alter table public.platform_staff_invitations enable row level security;
revoke all on public.platform_staff_invitations from public, anon, authenticated;
grant select on public.platform_staff_invitations to authenticated;
grant select, insert, update on public.platform_staff_invitations to service_role;
create policy platform_staff_invitations_admin_read on public.platform_staff_invitations for select to authenticated using (public.is_platform_admin());

-- Only the server's service role may reserve the one-time token.
create function public.reserve_platform_staff_invitation(requested_hash text)
returns table(id uuid, email text) language sql security definer set search_path = '' as $$
  update public.platform_staff_invitations i set status = 'processing'
  where i.token_hash = requested_hash and i.status = 'pending' and i.expires_at > now()
  returning i.id, i.email;
$$;
revoke all on function public.reserve_platform_staff_invitation(text) from public, anon, authenticated;
grant execute on function public.reserve_platform_staff_invitation(text) to service_role;
