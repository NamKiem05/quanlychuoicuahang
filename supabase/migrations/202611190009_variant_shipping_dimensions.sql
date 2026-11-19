begin;

alter table public.product_variant_drafts add column shipping_dimensions jsonb
  check (shipping_dimensions is null or (
    jsonb_typeof(shipping_dimensions) = 'object'
    and coalesce(shipping_dimensions ->> 'weight_g', '') ~ '^[1-9][0-9]{0,4}$'
    and coalesce(shipping_dimensions ->> 'length_cm', '') ~ '^[1-9][0-9]{0,2}$'
    and coalesce(shipping_dimensions ->> 'width_cm', '') ~ '^[1-9][0-9]{0,2}$'
    and coalesce(shipping_dimensions ->> 'height_cm', '') ~ '^[1-9][0-9]{0,2}$'
    and shipping_dimensions -> 'weight_g' between '1'::jsonb and '19999'::jsonb
    and shipping_dimensions -> 'length_cm' between '1'::jsonb and '200'::jsonb
    and shipping_dimensions -> 'width_cm' between '1'::jsonb and '200'::jsonb
    and shipping_dimensions -> 'height_cm' between '1'::jsonb and '200'::jsonb
  ));

grant select (id, store_id, product_id, shipping_dimensions) on public.product_variant_drafts to service_role;

create function public.create_product_with_variant_shipping(
  target_store uuid, product_name text, product_slug text, product_category uuid,
  product_brand uuid, product_description text, product_image text, product_price bigint,
  product_low_stock integer, requested_variants jsonb
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare new_product uuid;
begin
  new_product := public.create_product_with_variant_drafts(target_store, product_name, product_slug,
    product_category, product_brand, product_description, product_image, product_price,
    product_low_stock, requested_variants);
  update public.product_variant_drafts as v
  set shipping_dimensions = nullif(item.value -> 'shipping_dimensions', 'null'::jsonb)
  from jsonb_array_elements(requested_variants) as item(value)
  where v.product_id = new_product and v.store_id = target_store
    and v.attributes = item.value -> 'attributes';
  return new_product;
end;
$$;
revoke all on function public.create_product_with_variant_shipping(uuid,text,text,uuid,uuid,text,text,bigint,integer,jsonb) from public, anon, authenticated;
grant execute on function public.create_product_with_variant_shipping(uuid,text,text,uuid,uuid,text,text,bigint,integer,jsonb) to authenticated;

commit;
