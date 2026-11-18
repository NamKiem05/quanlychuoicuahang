-- Catalog metadata does not change existing storefront access or styles.
create table public.storefront_template_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 100),
  description text not null default '' check (char_length(description) <= 1000),
  category text not null default '' check (char_length(category) <= 80),
  base_style text not null check (base_style in ('original', 'modern', 'cozy', 'minimal')),
  required_plan text not null default 'plus' check (required_plan in ('basic', 'plus')),
  preview_url text check (preview_url is null or (char_length(preview_url) <= 2048 and preview_url ~ '^https://')),
  is_enabled boolean not null default false,
  is_featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.storefront_template_catalog enable row level security;
revoke all on public.storefront_template_catalog from public, anon, authenticated;
grant select, insert, update, delete on public.storefront_template_catalog to authenticated;
create policy storefront_template_catalog_admin on public.storefront_template_catalog for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
insert into public.storefront_template_catalog (name, description, category, base_style, required_plan, is_enabled)
values ('Giao diện hiện tại', 'Banner ngang và thẻ món bo góc.', 'Cơ bản', 'original', 'plus', true),
  ('Hiện đại', 'Ảnh bìa bo góc, tiêu đề đậm và thẻ món nổi bật.', 'Hiện đại', 'modern', 'plus', true),
  ('Ấm cúng', 'Kiểu chữ có chân, nền ấm và thẻ bo mềm.', 'Ấm cúng', 'cozy', 'plus', true),
  ('Tối giản', 'Đường nét gọn, nền trắng và viền mảnh.', 'Tối giản', 'minimal', 'plus', true);
