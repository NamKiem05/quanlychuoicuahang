-- Variant drafts are private to store members and are not connected to checkout.
create table public.product_variant_drafts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null,
  attributes jsonb not null check (jsonb_typeof(attributes) = 'object' and attributes <> '{}'::jsonb and octet_length(attributes::text) <= 4000),
  sku text check (sku is null or length(trim(sku)) between 1 and 100),
  price_vnd bigint not null check (price_vnd between 0 and 1000000000),
  stock_quantity integer not null default 0 check (stock_quantity between 0 and 10000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(product_id, store_id) references public.products(id, store_id) on delete cascade,
  unique(product_id, attributes)
);
create unique index product_variant_drafts_sku_unique on public.product_variant_drafts(store_id, lower(trim(sku))) where sku is not null;
alter table public.product_variant_drafts enable row level security;
revoke all on public.product_variant_drafts from public, anon, authenticated;
grant select, insert, update, delete on public.product_variant_drafts to authenticated;
create policy variants_store_access on public.product_variant_drafts for all to authenticated
  using (public.has_store_role(store_id)) with check (public.has_store_role(store_id));
