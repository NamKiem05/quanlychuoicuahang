alter table public.stores
  add column storefront_style text not null default 'original'
  check (storefront_style in ('original', 'modern', 'cozy', 'minimal'));

grant update (storefront_style) on public.stores to authenticated;
