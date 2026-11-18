-- Run only on a disposable Supabase project after applying the variant migration.
-- The fixture and all orders are rolled back, even if an assertion fails.
begin;

do $$
declare
  owner_id uuid := gen_random_uuid();
  shop_id uuid;
  product_id uuid;
  red_id uuid;
  black_id uuid;
  result jsonb;
  test_order_id uuid;
  failed boolean;
begin
  insert into auth.users(id, email, raw_app_meta_data, raw_user_meta_data)
  values (owner_id, 'variant-test-' || owner_id::text || '@example.invalid',
          '{"created_by_platform_admin":true}'::jsonb, '{}'::jsonb);
  perform set_config('request.jwt.claim.sub', owner_id::text, true);

  insert into public.stores(created_by, name, slug, status, accepts_orders)
  values(owner_id, 'Variant test store', 'variant-test-' || owner_id::text, 'active', true)
  returning id into shop_id;
  insert into public.store_members(store_id, user_id, role) values(shop_id, owner_id, 'owner');
  insert into public.products(store_id, name, slug, price_vnd, status)
  values(shop_id, 'Test shirt', 'test-shirt', 100000, 'draft') returning id into product_id;
  insert into public.product_variant_drafts(store_id, product_id, attributes, sku, price_vnd, stock_quantity)
  values(shop_id, product_id, '{"Màu":"Đỏ","Size":"M"}', 'TEST-RED-M', 120000, 3) returning id into red_id;
  insert into public.product_variant_drafts(store_id, product_id, attributes, sku, price_vnd, stock_quantity)
  values(shop_id, product_id, '{"Màu":"Đen","Size":"L"}', 'TEST-BLACK-L', 150000, 4) returning id into black_id;
  update public.products set status = 'active' where id = product_id;
  if not (select variants_enabled from public.products where id = product_id) then
    raise exception 'variant mode was not enabled';
  end if;

  failed := false;
  begin
    perform public.create_guest_order('variant-test-' || owner_id::text, 'Test customer', '0901234567', '',
      jsonb_build_array(jsonb_build_object('product_id', product_id, 'quantity', 1)));
  exception when sqlstate '22023' then failed := true;
  end;
  if not failed then raise exception 'order without variant was accepted'; end if;

  result := public.create_guest_order('variant-test-' || owner_id::text, 'Test customer', '0901234567', '',
    jsonb_build_array(jsonb_build_object('product_id', product_id, 'variant_id', red_id, 'quantity', 2),
                      jsonb_build_object('product_id', product_id, 'variant_id', black_id, 'quantity', 1)));
  if (result->>'total_vnd')::bigint <> 390000 then raise exception 'incorrect order total'; end if;
  if (select stock_quantity from public.product_variant_drafts where id = red_id) <> 1
    or (select stock_quantity from public.product_variant_drafts where id = black_id) <> 3 then
    raise exception 'incorrect stock deduction';
  end if;
  select id into strict test_order_id from public.orders where public_code = result->>'public_code';
  if (select count(*) from public.order_items where order_items.order_id = test_order_id and variant_id in (red_id, black_id)) <> 2 then
    raise exception 'variant snapshots missing from order';
  end if;

  failed := false;
  begin
    perform public.create_guest_order('variant-test-' || owner_id::text, 'Test customer', '0901234567', '',
      jsonb_build_array(jsonb_build_object('product_id', product_id, 'variant_id', red_id, 'quantity', 2)));
  exception when sqlstate 'P0002' then failed := true;
  end;
  if not failed then raise exception 'order exceeding stock was accepted'; end if;
  if (select stock_quantity from public.product_variant_drafts where id = red_id) <> 1 then
    raise exception 'failed checkout changed stock';
  end if;

  perform public.store_update_order_status(shop_id, test_order_id, 'cancelled');
  if (select stock_quantity from public.product_variant_drafts where id = red_id) <> 3
    or (select stock_quantity from public.product_variant_drafts where id = black_id) <> 4 then
    raise exception 'cancellation did not restore variant stock';
  end if;
end;
$$;
rollback;
