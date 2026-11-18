-- Platform-wide business categories, independent of each store's menu categories.
create table public.business_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 100),
  slug text not null unique check (char_length(slug) <= 100 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text not null default '' check (char_length(description) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index business_categories_name_unique on public.business_categories (lower(trim(name)));
alter table public.business_categories enable row level security;
revoke all on public.business_categories from public, anon, authenticated;
grant select, insert, update, delete on public.business_categories to authenticated;
create policy business_categories_admin_only on public.business_categories for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
