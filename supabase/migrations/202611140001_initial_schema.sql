-- Initial multi-store schema for the food commerce MVP.
-- Run this migration in the Supabase SQL Editor or with the Supabase CLI.

create extension if not exists postgis with schema extensions;

create type public.store_status as enum ('draft', 'active', 'paused', 'suspended');
create type public.store_member_role as enum ('owner', 'staff');
create type public.domain_type as enum ('subdomain', 'custom');
create type public.domain_verification_status as enum ('pending', 'verified', 'failed');
create type public.product_status as enum ('draft', 'active', 'archived');
create type public.order_status as enum (
  'pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled', 'rejected'
);
create type public.fulfillment_method as enum ('pickup');
create type public.payment_method as enum ('cash_on_pickup');
create type public.review_status as enum ('pending', 'published', 'hidden');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Platform admins are managed out of band; users cannot grant themselves this role.
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users (id) on delete restrict,
  name text not null check (length(trim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text not null default '',
  phone text,
  address text,
  location extensions.geography(point, 4326),
  logo_url text,
  banner_url text,
  status public.store_status not null default 'draft',
  accepts_orders boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.store_members (
  store_id uuid not null references public.stores (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.store_member_role not null default 'staff',
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);

create table public.store_domains (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  hostname text not null unique check (hostname = lower(hostname)),
  domain_type public.domain_type not null,
  verification_status public.domain_verification_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  slug text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, slug),
  unique (id, store_id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  category_id uuid,
  name text not null check (length(trim(name)) between 1 and 160),
  slug text not null,
  description text not null default '',
  price_vnd bigint not null check (price_vnd >= 0),
  image_url text,
  stock_quantity integer check (stock_quantity is null or stock_quantity >= 0),
  status public.product_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, slug),
  unique (id, store_id),
  foreign key (category_id, store_id)
    references public.categories (id, store_id)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  public_code text not null unique,
  customer_name text not null check (length(trim(customer_name)) between 1 and 120),
  customer_phone text not null,
  customer_note text not null default '',
  fulfillment public.fulfillment_method not null default 'pickup',
  payment_method public.payment_method not null default 'cash_on_pickup',
  status public.order_status not null default 'pending',
  subtotal_vnd bigint not null check (subtotal_vnd >= 0),
  total_vnd bigint not null check (total_vnd >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, store_id),
  check (total_vnd = subtotal_vnd)
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  store_id uuid not null,
  product_id uuid references public.products (id) on delete set null,
  product_name_snapshot text not null,
  unit_price_snapshot_vnd bigint not null check (unit_price_snapshot_vnd >= 0),
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  foreign key (order_id, store_id)
    references public.orders (id, store_id) on delete cascade
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  order_item_id uuid not null unique references public.order_items (id) on delete restrict,
  product_id uuid references public.products (id) on delete set null,
  display_name text not null,
  rating smallint not null check (rating between 1 and 5),
  body text not null default '',
  status public.review_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index stores_location_gix on public.stores using gist (location);
create index stores_status_idx on public.stores (status);
create index store_members_user_idx on public.store_members (user_id);
create index products_store_status_idx on public.products (store_id, status);
create index products_category_idx on public.products (category_id);
create index orders_store_status_created_idx on public.orders (store_id, status, created_at desc);
create index order_items_order_idx on public.order_items (order_id);
create index reviews_store_status_created_idx on public.reviews (store_id, status, created_at desc);

create function public.find_nearby_stores(requested_lat double precision, requested_lon double precision)
returns table (
  id uuid,
  name text,
  slug text,
  description text,
  phone text,
  address text,
  logo_url text,
  banner_url text,
  distance_m integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    s.id,
    s.name,
    s.slug,
    s.description,
    s.phone,
    s.address,
    s.logo_url,
    s.banner_url,
    round(extensions.st_distance(
      s.location,
      extensions.st_setsrid(extensions.st_makepoint(requested_lon, requested_lat), 4326)::extensions.geography
    ))::integer as distance_m
  from public.stores as s
  where s.status = 'active'
    and s.location is not null
    and extensions.st_dwithin(
      s.location,
      extensions.st_setsrid(extensions.st_makepoint(requested_lon, requested_lat), 4326)::extensions.geography,
      5000
    )
  order by distance_m asc
  limit 50;
$$;

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create function public.create_profile_for_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins
    where user_id = (select auth.uid())
  );
$$;

create function public.has_store_role(
  requested_store_id uuid,
  allowed_roles public.store_member_role[] default array['owner', 'staff']::public.store_member_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.store_members
    where store_id = requested_store_id
      and user_id = (select auth.uid())
      and role = any (allowed_roles)
  );
$$;

create trigger auth_user_created_profile
  after insert on auth.users
  for each row execute function public.create_profile_for_new_auth_user();

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger stores_set_updated_at before update on public.stores
  for each row execute function public.set_updated_at();
create trigger store_domains_set_updated_at before update on public.store_domains
  for each row execute function public.set_updated_at();
create trigger categories_set_updated_at before update on public.categories
  for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger orders_set_updated_at before update on public.orders
  for each row execute function public.set_updated_at();
create trigger reviews_set_updated_at before update on public.reviews
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.platform_admins enable row level security;
alter table public.stores enable row level security;
alter table public.store_members enable row level security;
alter table public.store_domains enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.reviews enable row level security;

create policy profiles_read_self on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_platform_admin()));
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy stores_read_public_or_member on public.stores
  for select to anon, authenticated
  using (
    status = 'active'
    or created_by = (select auth.uid())
    or (select public.has_store_role(id))
    or (select public.is_platform_admin())
  );
create policy stores_create_draft on public.stores
  for insert to authenticated
  with check (created_by = (select auth.uid()) and status = 'draft');
create policy stores_update_owner on public.stores
  for update to authenticated
  using ((select public.has_store_role(id, array['owner']::public.store_member_role[]))
    or (select public.is_platform_admin()))
  with check ((select public.has_store_role(id, array['owner']::public.store_member_role[]))
    or (select public.is_platform_admin()));

create policy store_members_read_related on public.store_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.has_store_role(store_id, array['owner']::public.store_member_role[]))
    or (select public.is_platform_admin())
  );
create policy store_members_add_related on public.store_members
  for insert to authenticated
  with check (
    (
      user_id = (select auth.uid())
      and role = 'owner'
      and exists (
        select 1 from public.stores
        where id = store_id and created_by = (select auth.uid())
      )
    )
    or (select public.has_store_role(store_id, array['owner']::public.store_member_role[]))
    or (select public.is_platform_admin())
  );
create policy store_members_update_owner on public.store_members
  for update to authenticated
  using ((select public.has_store_role(store_id, array['owner']::public.store_member_role[]))
    or (select public.is_platform_admin()))
  with check ((select public.has_store_role(store_id, array['owner']::public.store_member_role[]))
    or (select public.is_platform_admin()));
create policy store_members_remove_owner on public.store_members
  for delete to authenticated
  using ((select public.has_store_role(store_id, array['owner']::public.store_member_role[]))
    or (select public.is_platform_admin()));

create policy store_domains_read_owner on public.store_domains
  for select to authenticated
  using ((select public.has_store_role(store_id, array['owner']::public.store_member_role[]))
    or (select public.is_platform_admin()));
create policy store_domains_add_pending on public.store_domains
  for insert to authenticated
  with check (
    verification_status = 'pending'
    and (
      (select public.has_store_role(store_id, array['owner']::public.store_member_role[]))
      or (select public.is_platform_admin())
    )
  );
create policy store_domains_update_owner on public.store_domains
  for update to authenticated
  using ((select public.has_store_role(store_id, array['owner']::public.store_member_role[]))
    or (select public.is_platform_admin()))
  with check ((select public.has_store_role(store_id, array['owner']::public.store_member_role[]))
    or (select public.is_platform_admin()));
create policy store_domains_delete_owner on public.store_domains
  for delete to authenticated
  using ((select public.has_store_role(store_id, array['owner']::public.store_member_role[]))
    or (select public.is_platform_admin()));

create policy categories_read_live_or_member on public.categories
  for select to anon, authenticated
  using (
    (is_active and exists (
      select 1 from public.stores s where s.id = store_id and s.status = 'active'
    ))
    or (select public.has_store_role(store_id))
    or (select public.is_platform_admin())
  );
create policy categories_manage_store on public.categories
  for all to authenticated
  using ((select public.has_store_role(store_id)) or (select public.is_platform_admin()))
  with check ((select public.has_store_role(store_id)) or (select public.is_platform_admin()));

create policy products_read_live_or_member on public.products
  for select to anon, authenticated
  using (
    (status = 'active' and exists (
      select 1 from public.stores s where s.id = store_id and s.status = 'active'
    ))
    or (select public.has_store_role(store_id))
    or (select public.is_platform_admin())
  );
create policy products_manage_store on public.products
  for all to authenticated
  using ((select public.has_store_role(store_id)) or (select public.is_platform_admin()))
  with check ((select public.has_store_role(store_id)) or (select public.is_platform_admin()));

create policy orders_read_store_members on public.orders
  for select to authenticated
  using ((select public.has_store_role(store_id)) or (select public.is_platform_admin()));
create policy order_items_read_store_members on public.order_items
  for select to authenticated
  using ((select public.has_store_role(store_id)) or (select public.is_platform_admin()));

create policy reviews_read_published_or_store on public.reviews
  for select to anon, authenticated
  using (
    status = 'published'
    or (select public.has_store_role(store_id))
    or (select public.is_platform_admin())
  );

revoke all privileges on public.profiles, public.platform_admins, public.stores,
  public.store_members, public.store_domains, public.categories, public.products,
  public.orders, public.order_items, public.reviews from anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;
grant execute on function public.is_platform_admin() to anon, authenticated, service_role;
grant execute on function public.has_store_role(uuid, public.store_member_role[]) to anon, authenticated, service_role;
grant execute on function public.find_nearby_stores(double precision, double precision) to anon, authenticated, service_role;

grant select on public.stores, public.categories, public.products, public.reviews to anon, authenticated;
grant select on public.profiles, public.store_members, public.store_domains,
  public.orders, public.order_items to authenticated;

grant update (display_name, phone) on public.profiles to authenticated;
grant insert (created_by, name, slug, description, phone, address, location, logo_url, banner_url, status, accepts_orders)
  on public.stores to authenticated;
grant update (name, slug, description, phone, address, location, logo_url, banner_url, accepts_orders)
  on public.stores to authenticated;
grant insert, update, delete on public.store_members to authenticated;
grant insert (store_id, hostname, domain_type) on public.store_domains to authenticated;
grant update (hostname) on public.store_domains to authenticated;
grant delete on public.store_domains to authenticated;
grant insert, update, delete on public.categories, public.products to authenticated;

grant all on public.profiles, public.platform_admins, public.stores, public.store_members,
  public.store_domains, public.categories, public.products, public.orders,
  public.order_items, public.reviews to service_role;
