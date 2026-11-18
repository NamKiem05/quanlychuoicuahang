-- ONLY for the disposable GrowDesk Test project. This intentionally commits
-- a demo storefront so the customer UI can be tested without real store data.
begin;
do $$
declare
  owner_id uuid := gen_random_uuid();
  category_id uuid;
  shop_id uuid;
  product_id uuid;
begin
  if exists(select 1 from public.stores where slug = 'variant-demo') then
    raise exception 'variant-demo already exists; do not overwrite it';
  end if;
  insert into auth.users(id, email, raw_app_meta_data, raw_user_meta_data)
  values(owner_id, 'variant-ui-' || owner_id::text || '@example.invalid',
    '{"created_by_platform_admin":true}'::jsonb, '{}'::jsonb);
  insert into public.business_categories(name, slug, merchandise_mode)
  values('Thời trang thử nghiệm', 'variant-demo-fashion', 'retail') returning id into category_id;
  insert into public.stores(created_by, name, slug, status, accepts_orders, business_category_id)
  values(owner_id, 'Cửa hàng thử biến thể', 'variant-demo', 'active', true, category_id) returning id into shop_id;
  insert into public.store_members(store_id, user_id, role) values(shop_id, owner_id, 'owner');
  insert into public.products(store_id, name, slug, description, price_vnd, status)
  values(shop_id, 'Áo thử biến thể', 'ao-thu-bien-the', 'Sản phẩm phục vụ kiểm thử.', 120000, 'draft') returning id into product_id;
  insert into public.product_variant_drafts(store_id, product_id, attributes, sku, price_vnd, stock_quantity)
  values(shop_id, product_id, '{"Màu sắc":"Đỏ","Kích cỡ":"M"}', 'TEST-RED-M', 120000, 3),
        (shop_id, product_id, '{"Màu sắc":"Đen","Kích cỡ":"L"}', 'TEST-BLACK-L', 150000, 4);
  update public.products set status = 'active' where id = product_id;
end; $$;
commit;
