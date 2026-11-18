-- Run on GrowDesk Test after 202611180044. All fixtures and orders roll back.
begin;
do $$
declare
  test_user uuid := gen_random_uuid();
  item record;
  result jsonb;
  denied boolean;
begin
  select v.id, v.product_id into strict item
  from public.product_variant_drafts v join public.stores s on s.id = v.store_id
  where s.slug = 'variant-demo' and v.stock_quantity > 0 order by v.id limit 1;
  insert into auth.users(id, email, raw_app_meta_data, raw_user_meta_data)
  values(test_user, 'checkout-auth-' || test_user::text || '@example.invalid',
         '{"created_by_platform_admin":true}'::jsonb, '{}'::jsonb);
  perform set_config('request.jwt.claim.sub', '', true);
  denied := false;
  begin
    perform public.create_guest_order('variant-demo', 'Test', '0900000000', '',
      jsonb_build_array(jsonb_build_object('product_id', item.product_id, 'variant_id', item.id, 'quantity', 1)));
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'anonymous retail order was accepted'; end if;

  perform set_config('request.jwt.claim.sub', test_user::text, true);
  denied := false;
  begin
    perform public.create_guest_order('variant-demo', 'Test', '0900000000', '',
      jsonb_build_array(jsonb_build_object('product_id', item.product_id, 'variant_id', item.id, 'quantity', 1)));
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'unverified account was accepted'; end if;

  update auth.users set email_confirmed_at = now() where id = test_user;
  result := public.create_guest_order('variant-demo', 'Test', '0900000000', '',
    jsonb_build_array(jsonb_build_object('product_id', item.product_id, 'variant_id', item.id, 'quantity', 1)));
  if not exists(select 1 from public.orders o where o.public_code = result->>'public_code' and o.customer_user_id = test_user) then
    raise exception 'order was not linked to verified account';
  end if;
end;
$$;
rollback;
