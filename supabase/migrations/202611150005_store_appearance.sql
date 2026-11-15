-- Merchant-controlled storefront brand colors. Logo and banner URLs already
-- exist on stores; they reuse the store-scoped product-images bucket.
alter table public.stores
  add column if not exists theme_preset text not null default 'green';

alter table public.stores
  add constraint stores_theme_preset_check
  check (theme_preset in ('green', 'orange', 'blue', 'rose'));

grant update (theme_preset) on public.stores to authenticated;
