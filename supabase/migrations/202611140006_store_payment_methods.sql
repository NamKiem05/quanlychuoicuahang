-- Store-specific bank transfer QR settings and order payment tracking.
-- This migration must be committed before the RPC migration adds the new enum value usage.

alter type public.payment_method add value if not exists 'bank_transfer';

create table public.store_payment_methods (
  store_id uuid primary key references public.stores (id) on delete cascade,
  bank_code text not null check (bank_code = upper(bank_code) and length(bank_code) between 2 and 12),
  bank_name text not null check (length(trim(bank_name)) between 2 and 120),
  account_number text not null check (account_number ~ '^[0-9]{6,30}$'),
  account_name text not null check (length(trim(account_name)) between 2 and 100),
  is_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger store_payment_methods_set_updated_at
  before update on public.store_payment_methods
  for each row execute function public.set_updated_at();

alter table public.store_payment_methods enable row level security;

create policy store_payment_methods_read_enabled_or_member
  on public.store_payment_methods for select to anon, authenticated
  using (
    (
      is_enabled
      and exists (
        select 1 from public.stores as s
        where s.id = store_id and s.status = 'active'
      )
    )
    or (select public.has_store_role(store_id))
    or (select public.is_platform_admin())
  );

create policy store_payment_methods_insert_owner
  on public.store_payment_methods for insert to authenticated
  with check (
    (select public.has_store_role(store_id, array['owner']::public.store_member_role[]))
    or (select public.is_platform_admin())
  );

create policy store_payment_methods_update_owner
  on public.store_payment_methods for update to authenticated
  using (
    (select public.has_store_role(store_id, array['owner']::public.store_member_role[]))
    or (select public.is_platform_admin())
  )
  with check (
    (select public.has_store_role(store_id, array['owner']::public.store_member_role[]))
    or (select public.is_platform_admin())
  );

revoke all on public.store_payment_methods from public;
grant select on public.store_payment_methods to anon, authenticated;
grant insert, update on public.store_payment_methods to authenticated;

alter table public.orders
  add column payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'awaiting_payment', 'paid')),
  add column payment_reference text,
  add column payment_bank_code text,
  add column payment_bank_name text,
  add column payment_account_number text,
  add column payment_account_name text,
  add column payment_confirmed_at timestamptz,
  add column payment_confirmed_by uuid references auth.users (id) on delete set null;

create unique index orders_payment_reference_uidx
  on public.orders (payment_reference)
  where payment_reference is not null;

create index orders_store_payment_status_idx
  on public.orders (store_id, payment_status, created_at desc);
