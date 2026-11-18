-- GrowDesk Test only. All fixtures and changes are rolled back.
begin;
select set_config('test.owner',gen_random_uuid()::text,true), set_config('test.outsider',gen_random_uuid()::text,true), set_config('test.product',gen_random_uuid()::text,true), set_config('test.variant',gen_random_uuid()::text,true);
select set_config('test.store',(select id::text from public.stores where slug='variant-demo' limit 1),true);
do $$ begin if nullif(current_setting('test.store',true),'') is null then raise exception 'Missing test store variant-demo'; end if; end $$;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
(current_setting('test.owner')::uuid,'inventory-owner-'||current_setting('test.owner')||'@example.invalid',now(),'{"created_by_platform_admin":true}','{}'),
(current_setting('test.outsider')::uuid,'inventory-other-'||current_setting('test.outsider')||'@example.invalid',now(),'{"created_by_platform_admin":true}','{}');
insert into public.store_members(store_id,user_id,role) values(current_setting('test.store')::uuid,current_setting('test.owner')::uuid,'staff');
insert into public.products(id,store_id,name,slug,price_vnd,stock_quantity) values(current_setting('test.product')::uuid,current_setting('test.store')::uuid,'Kiểm thử kho','test-inventory-'||current_setting('test.product'),1000,5);
insert into public.product_variant_drafts(id,store_id,product_id,attributes,price_vnd,stock_quantity) values(current_setting('test.variant')::uuid,current_setting('test.store')::uuid,current_setting('test.product')::uuid,'{"Màu":"Đỏ"}',1000,3);
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.owner'),true);
select public.adjust_inventory(current_setting('test.store')::uuid,current_setting('test.product')::uuid,current_setting('test.variant')::uuid,3,7,'Kiểm kê');
do $$ declare n integer; begin
  if (select stock_quantity from public.product_variant_drafts where id=current_setting('test.variant')::uuid) <> 7 then raise exception 'Variant adjustment failed'; end if;
  select count(*) into n from public.inventory_events where variant_id=current_setting('test.variant')::uuid and old_stock=3 and new_stock=7 and note='Kiểm kê';
  if n <> 1 then raise exception 'Variant history missing'; end if;
  begin perform public.adjust_inventory(current_setting('test.store')::uuid,current_setting('test.product')::uuid,current_setting('test.variant')::uuid,3,8,'Stale'); raise exception 'Stale adjustment accepted'; exception when serialization_failure then null; end;
end $$;
select public.adjust_inventory(current_setting('test.store')::uuid,current_setting('test.product')::uuid,null,5,9,'Nhập hàng');
update public.product_variant_drafts set stock_quantity=6 where id=current_setting('test.variant')::uuid;
do $$ begin if not exists(select 1 from public.inventory_events where variant_id=current_setting('test.variant')::uuid and old_stock=7 and new_stock=6 and note is null) then raise exception 'Automatic stock history missing'; end if; end $$;
select set_config('request.jwt.claim.sub',current_setting('test.outsider'),true);
do $$ begin
  if exists(select 1 from public.inventory_events where product_id=current_setting('test.product')::uuid) then raise exception 'Other user can read stock history'; end if;
  begin perform public.adjust_inventory(current_setting('test.store')::uuid,current_setting('test.product')::uuid,null,9,12,'Unauthorized'); raise exception 'Other user can adjust stock'; exception when insufficient_privilege then null; end;
end $$;
rollback;
