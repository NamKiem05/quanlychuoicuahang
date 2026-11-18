-- Customer-owned addresses are shared across stores and never grant store membership.
create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  recipient_name text not null check (length(trim(recipient_name)) between 1 and 120),
  phone text not null check (phone ~ '^[0-9+() .-]{9,16}$'),
  address text not null check (length(trim(address)) between 5 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.customer_addresses enable row level security;
revoke all on public.customer_addresses from anon, authenticated;
grant select, delete on public.customer_addresses to authenticated;
grant insert (recipient_name, phone, address) on public.customer_addresses to authenticated;
grant update (recipient_name, phone, address) on public.customer_addresses to authenticated;
create policy customer_addresses_select_self on public.customer_addresses for select to authenticated using ((select auth.uid()) = user_id);
create policy customer_addresses_insert_self on public.customer_addresses for insert to authenticated with check ((select auth.uid()) = user_id);
create policy customer_addresses_update_self on public.customer_addresses for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy customer_addresses_delete_self on public.customer_addresses for delete to authenticated using ((select auth.uid()) = user_id);
create index if not exists customer_addresses_user_created_idx on public.customer_addresses (user_id, created_at desc);
create trigger customer_addresses_set_updated_at before update on public.customer_addresses for each row execute function public.set_updated_at();
