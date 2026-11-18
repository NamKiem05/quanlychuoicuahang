-- Run only on GrowDesk Test after 202611190002; no fixtures are retained.
begin;
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); variant record;
  result jsonb; code text; denied boolean;
  food_category uuid; food_store uuid; food_product uuid; food_slug text := 'food-test-' || a::text;
begin
  select v.id, v.product_id into strict variant from public.product_variant_drafts v
  join public.stores s on s.id = v.store_id
  where s.slug = 'variant-demo' and v.stock_quantity > 0 order by v.id limit 1;
  insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
  values(a,'tracking-a-'||a::text||'@example.invalid',now(),'{"created_by_platform_admin":true}','{}'),
        (b,'tracking-b-'||b::text||'@example.invalid',now(),'{"created_by_platform_admin":true}','{}');
  perform set_config('request.jwt.claim.sub', a::text, true);
  result := public.create_guest_order('variant-demo','Test','0900000000','',jsonb_build_array(jsonb_build_object('product_id',variant.product_id,'variant_id',variant.id,'quantity',1)));
  code := result->>'public_code';
  if public.track_guest_order(code,'0900000000') is null then raise exception 'owner tracking needed by QR polling is unavailable'; end if;
  perform set_config('request.jwt.claim.sub', b::text, true);
  if public.track_guest_order(code,'0900000000') is not null then raise exception 'other account can track retail order'; end if;
  denied := false;
  begin
    perform public.request_guest_order_cancellation(code,'0900000000','Lý do thử nghiệm');
  exception when no_data_found then denied := true;
  end;
  if not denied then raise exception 'other account can cancel retail order'; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  if public.track_guest_order(code,'0900000000') is not null then raise exception 'anonymous retail tracking was accepted'; end if;
  perform set_config('request.jwt.claim.sub', a::text, true);
  if public.request_guest_order_cancellation(code,'0900000000','Lý do thử nghiệm')->>'status' <> 'pending' then raise exception 'owner cannot request cancellation'; end if;
  insert into public.business_categories(name,slug,merchandise_mode) values('Food test '||a::text,food_slug,'food') returning id into food_category;
  insert into public.stores(created_by,name,slug,status,accepts_orders,business_category_id) values(a,'Food test',food_slug,'active',true,food_category) returning id into food_store;
  insert into public.products(store_id,name,slug,price_vnd,status) values(food_store,'Test item','test-item',10000,'active') returning id into food_product;
  perform set_config('request.jwt.claim.sub', '', true);
  result := public.create_guest_order(food_slug,'Test','0900000001','',jsonb_build_array(jsonb_build_object('product_id',food_product,'quantity',1)));
  if public.track_guest_order(result->>'public_code','0900000001') is null then raise exception 'food guest tracking was broken'; end if;
end; $$;
rollback;
