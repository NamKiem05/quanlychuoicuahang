-- GHN staging shipments; snapshots and provider identifiers remain server-only.
create table public.store_ghn_shipments (
  order_id uuid primary key references public.orders(id) on delete restrict,
  store_id uuid not null references public.stores(id) on delete cascade,
  shop_id bigint not null check(shop_id > 0),
  client_order_code text not null,
  request_payload jsonb not null,
  state text not null default 'pending' check(state in ('pending','created')),
  order_code text,
  total_fee bigint,
  expected_delivery_time timestamptz,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(store_id,shop_id,client_order_code),
  check ((state = 'pending' and order_code is null) or (state = 'created' and order_code is not null))
);
alter table public.store_ghn_shipments enable row level security;
revoke all on public.store_ghn_shipments from public, anon, authenticated;
grant select,insert,update,delete on public.store_ghn_shipments to service_role;
