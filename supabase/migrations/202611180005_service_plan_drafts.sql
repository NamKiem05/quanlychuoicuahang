-- Drafts are intentionally separate from live billing until pricing, snapshots,
-- entitlements and quota enforcement are migrated together.
create table public.service_plan_drafts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 100),
  description text not null default '' check (char_length(description) <= 1000),
  price_vnd integer not null check (price_vnd >= 0),
  billing_months integer not null check (billing_months between 1 and 36),
  trial_days integer not null default 0 check (trial_days between 0 and 365),
  product_limit integer check (product_limit between 0 and 10000000),
  order_limit integer check (order_limit between 0 and 10000000),
  staff_limit integer check (staff_limit between 0 and 10000000),
  storage_mb integer check (storage_mb between 0 and 10000000),
  website_limit integer check (website_limit between 0 and 10000000),
  features jsonb not null default '{}'::jsonb check (jsonb_typeof(features) = 'object'),
  status text not null default 'draft' check (status in ('draft', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.service_plan_drafts enable row level security;
revoke all on public.service_plan_drafts from public, anon, authenticated;
grant select, insert, update, delete on public.service_plan_drafts to authenticated;
create policy service_plan_drafts_admin on public.service_plan_drafts for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
