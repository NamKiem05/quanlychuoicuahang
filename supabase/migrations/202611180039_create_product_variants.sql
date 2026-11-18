alter table public.product_variant_drafts add column cost_vnd bigint check (cost_vnd is null or cost_vnd between 0 and 1000000000);

-- Product and draft variants are created in the same transaction under the caller's RLS permissions.
create function public.create_product_with_variant_drafts(
  target_store uuid, product_name text, product_slug text, product_category uuid,
  product_brand uuid, product_description text, product_image text, product_price bigint,
  product_low_stock integer, requested_variants jsonb
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare new_product uuid; item jsonb; sku_value text; cost_value bigint;
begin
  if auth.uid() is null or not public.has_store_role(target_store) then raise exception 'not authorized' using errcode='42501'; end if;
  if char_length(trim(coalesce(product_name,''))) not between 1 and 160 or char_length(coalesce(product_description,'')) > 2000 or product_price is null or product_price < 0 or product_low_stock < 0 or jsonb_typeof(requested_variants) is distinct from 'array' or jsonb_array_length(requested_variants) not between 1 and 80 then raise exception 'invalid product or variants' using errcode='22023'; end if;
  insert into public.products(store_id,name,slug,category_id,brand_id,description,image_url,price_vnd,stock_quantity,low_stock_threshold,status)
  values(target_store,trim(product_name),product_slug,product_category,product_brand,coalesce(product_description,''),product_image,product_price,null,coalesce(product_low_stock,5),'draft') returning id into new_product;
  for item in select value from jsonb_array_elements(requested_variants) loop
    if jsonb_typeof(item) <> 'object' or jsonb_typeof(item->'attributes') <> 'object' or (item->>'price') !~ '^\d{1,10}$' or (item->>'stock') !~ '^\d{1,8}$' or (coalesce(item->>'cost','') <> '' and (item->>'cost') !~ '^\d{1,10}$') then raise exception 'invalid variant' using errcode='22023'; end if;
    sku_value := nullif(trim(coalesce(item->>'sku','')), '');
    cost_value := case when coalesce(item->>'cost','') = '' then null else (item->>'cost')::bigint end;
    insert into public.product_variant_drafts(store_id,product_id,attributes,sku,price_vnd,cost_vnd,stock_quantity)
    values(target_store,new_product,item->'attributes',sku_value,(item->>'price')::bigint,cost_value,(item->>'stock')::integer);
  end loop;
  return new_product;
end; $$;
revoke all on function public.create_product_with_variant_drafts(uuid,text,text,uuid,uuid,text,text,bigint,integer,jsonb) from public, anon, authenticated;
grant execute on function public.create_product_with_variant_drafts(uuid,text,text,uuid,uuid,text,text,bigint,integer,jsonb) to authenticated;

-- Prevent publishing newly drafted variant products before checkout supports them.
create function public.prevent_publishing_product_with_variant_drafts()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'active' and old.status is distinct from 'active' and exists (select 1 from public.product_variant_drafts v where v.product_id = new.id and v.store_id = new.store_id) then
    raise exception 'variant_checkout_not_ready' using errcode = '23514';
  end if;
  return new;
end; $$;
revoke all on function public.prevent_publishing_product_with_variant_drafts() from public, anon, authenticated;
create trigger prevent_publishing_variant_drafts before update of status on public.products for each row execute function public.prevent_publishing_product_with_variant_drafts();
