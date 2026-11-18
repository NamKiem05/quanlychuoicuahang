-- Only on GrowDesk Test, after 202611190001. All test data is rolled back.
begin;
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  variant record; result_a jsonb; result_b jsonb; id_a uuid; id_b uuid;
begin
  select v.id, v.product_id into strict variant from public.product_variant_drafts v
  join public.stores s on s.id = v.store_id
  where s.slug = 'variant-demo' and v.stock_quantity >= 2 order by v.id limit 1;
  insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
  values(a,'orders-a-'||a::text||'@example.invalid',now(),'{"created_by_platform_admin":true}','{}'),
        (b,'orders-b-'||b::text||'@example.invalid',now(),'{"created_by_platform_admin":true}','{}');
  perform set_config('request.jwt.claim.sub', a::text, true);
  result_a := public.create_guest_order('variant-demo','Test A','0900000000','',jsonb_build_array(jsonb_build_object('product_id',variant.product_id,'variant_id',variant.id,'quantity',1)));
  select id into strict id_a from public.orders where public_code = result_a->>'public_code';
  perform set_config('request.jwt.claim.sub', b::text, true);
  result_b := public.create_guest_order('variant-demo','Test B','0900000001','',jsonb_build_array(jsonb_build_object('product_id',variant.product_id,'variant_id',variant.id,'quantity',1)));
  select id into strict id_b from public.orders where public_code = result_b->>'public_code';
  if public.customer_order_detail(id_a) is not null then raise exception 'customer B can read customer A order'; end if;
  if public.customer_order_detail(id_b)->>'id' <> id_b::text then raise exception 'customer B cannot read their own order'; end if;
  if exists(select 1 from jsonb_array_elements(public.customer_orders(0)) x where x->>'id'=id_a::text) then raise exception 'customer A order leaked into customer B list'; end if;
  perform set_config('request.jwt.claim.sub', a::text, true);
  if public.customer_order_detail(id_b) is not null then raise exception 'customer A can read customer B order'; end if;
  if public.customer_order_detail(id_a)->>'id' <> id_a::text then raise exception 'customer A cannot read their own order'; end if;
end; $$;
rollback;
