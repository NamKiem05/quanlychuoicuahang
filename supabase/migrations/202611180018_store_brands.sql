create table if not exists public.store_brands (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  description text not null default '' check (length(description) <= 2000),
  logo_url text,
  created_at timestamptz not null default now(),
  unique (id, store_id)
);
create unique index if not exists store_brands_store_name_unique on public.store_brands (store_id, lower(trim(name)));
alter table public.store_brands enable row level security;
grant select, insert, update, delete on public.store_brands to authenticated;
create policy store_brands_read on public.store_brands for select to authenticated using (public.has_store_role(store_id));
create policy store_brands_write on public.store_brands for all to authenticated
  using (public.has_store_role(store_id, array['owner']::public.store_member_role[]))
  with check (public.has_store_role(store_id, array['owner']::public.store_member_role[]));
alter table public.products add column if not exists brand_id uuid;
alter table public.products add constraint products_brand_store_fkey foreign key (brand_id, store_id) references public.store_brands(id, store_id) on delete restrict;
create index if not exists products_store_brand_idx on public.products(store_id, brand_id);
