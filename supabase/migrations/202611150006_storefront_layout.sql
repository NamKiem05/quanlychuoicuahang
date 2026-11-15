-- Store-owner-controlled ordering and visibility for storefront content.
alter table public.stores
  add column if not exists storefront_layout text not null default 'classic'
    check (storefront_layout in ('classic', 'menu-first', 'story-first')),
  add column if not exists storefront_section_order text[] not null
    default array['hero', 'menu', 'reviews', 'story']::text[],
  add column if not exists storefront_hidden_sections text[] not null default array[]::text[];

alter table public.stores
  add constraint stores_storefront_section_order_check check (
    cardinality(storefront_section_order) = 4
    and storefront_section_order <@ array['hero', 'menu', 'reviews', 'story']::text[]
    and storefront_section_order @> array['hero', 'menu', 'reviews', 'story']::text[]
  ),
  add constraint stores_storefront_hidden_sections_check check (
    cardinality(storefront_hidden_sections) <= 3
    and storefront_hidden_sections <@ array['hero', 'reviews', 'story']::text[]
  );

grant update (storefront_layout, storefront_section_order, storefront_hidden_sections)
  on public.stores to authenticated;
