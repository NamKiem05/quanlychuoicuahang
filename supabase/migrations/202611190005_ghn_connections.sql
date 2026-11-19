-- Private GHN credentials are accessible only to the server service role.
create table public.store_ghn_connections (
  store_id uuid primary key references public.stores(id) on delete cascade,
  environment text not null check (environment = 'staging'),
  shop_id bigint not null check (shop_id > 0),
  token_ciphertext text not null,
  shop_name text not null,
  checked_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.store_ghn_connections enable row level security;
revoke all on public.store_ghn_connections from public, anon, authenticated;
grant select,insert,update,delete on public.store_ghn_connections to service_role;
