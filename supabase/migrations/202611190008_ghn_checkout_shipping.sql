begin;

alter table public.products add column shipping_dimensions jsonb
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
alter table public.orders add column ghn_shipping_quote jsonb;

create table public.store_ghn_packaging (
  store_id uuid primary key references public.stores(id) on delete cascade,
  kind text not null check (kind in ('box', 'bag')),
  length_cm integer not null check (length_cm between 1 and 200),
  width_cm integer not null check (width_cm between 1 and 200),
  height_cm integer not null check (height_cm between 1 and 200),
  weight_g integer not null check (weight_g between 0 and 19998),
  packing_rule text not null check (packing_rule in ('single', 'stack'))
);

alter table public.store_ghn_packaging enable row level security;
revoke all on public.store_ghn_packaging from public, anon, authenticated;
grant select, insert, update, delete on public.store_ghn_packaging to service_role;

-- A quote is written only by the application server and redeemed once, inside checkout.
create table public.ghn_checkout_quotes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  shop_id bigint not null,
  items jsonb not null,
  address_hash text not null check (length(address_hash) = 64),
  snapshot jsonb not null,
  fee_vnd bigint not null check (fee_vnd >= 0),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  redeemed_at timestamptz
);
create index ghn_checkout_quotes_expiry_idx on public.ghn_checkout_quotes (store_id, expires_at);

alter table public.ghn_checkout_quotes enable row level security;
revoke all on public.ghn_checkout_quotes from public, anon, authenticated;
grant select, insert, update, delete on public.ghn_checkout_quotes to service_role;

create function public.create_product_with_shipping_variant_drafts(
  target_store uuid, product_name text, product_slug text, product_category uuid,
  product_brand uuid, product_description text, product_image text, product_price bigint,
  product_low_stock integer, requested_variants jsonb, product_shipping jsonb
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare new_product uuid;
begin
  new_product := public.create_product_with_variant_drafts(target_store, product_name, product_slug,
    product_category, product_brand, product_description, product_image, product_price,
    product_low_stock, requested_variants);
  update public.products set shipping_dimensions = product_shipping
  where id = new_product and store_id = target_store;
  return new_product;
end;
$$;
revoke all on function public.create_product_with_shipping_variant_drafts(uuid,text,text,uuid,uuid,text,text,bigint,integer,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.create_product_with_shipping_variant_drafts(uuid,text,text,uuid,uuid,text,text,bigint,integer,jsonb,jsonb) to authenticated;


alter table public.orders drop constraint orders_delivery_fields_match_fulfillment_check;
alter table public.orders add constraint orders_delivery_fields_match_fulfillment_check check (
  (fulfillment = 'pickup' and delivery_address is null and delivery_latitude is null
    and delivery_longitude is null and delivery_distance_m is null and delivery_fee_vnd = 0
    and ghn_shipping_quote is null)
  or (fulfillment = 'delivery' and delivery_address is not null and (
    (ghn_shipping_quote is null and delivery_latitude is not null and delivery_longitude is not null
      and delivery_distance_m is not null)
    or (ghn_shipping_quote is not null and delivery_latitude is null and delivery_longitude is null
      and delivery_distance_m is null)
  ))
);

create function public.create_ghn_delivery_order(
  requested_store_slug text,
  requested_customer_name text,
  requested_customer_phone text,
  requested_customer_note text,
  requested_items jsonb,
  requested_payment_method text,
  requested_delivery_address text,
  shipping_quote jsonb,
  shipping_fee bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_method public.payment_method;
  v_result jsonb;
  v_order public.orders%rowtype;
  v_settings public.store_payment_methods%rowtype;
  v_payment_reference text;
  v_total_vnd bigint;
begin
  if requested_payment_method is null or requested_payment_method not in ('cash_on_pickup', 'cash_on_delivery', 'bank_transfer') then
    raise exception 'invalid payment method' using errcode = '22023';
  end if;
  if requested_payment_method = 'bank_transfer' then
    v_payment_method := 'bank_transfer';
  else
    v_payment_method := 'cash_on_delivery';
  end if;

  -- Keep the original RPC responsible for validating products and customer details.
  v_result := public.create_guest_order(
    requested_store_slug,
    requested_customer_name,
    requested_customer_phone,
    requested_customer_note,
    requested_items
  );

  select * into v_order
  from public.orders
  where public_code = (v_result ->> 'public_code')
  for update;
  if not found then
    raise exception 'created order was not found' using errcode = 'P0002';
  end if;

  v_total_vnd := v_order.subtotal_vnd + shipping_fee;
  if v_payment_method = 'bank_transfer' then
    if v_total_vnd <= 0 then
      raise exception 'bank transfer order must have a positive amount' using errcode = '22023';
    end if;

    select * into v_settings
    from public.store_payment_methods
    where store_id = v_order.store_id and is_enabled = true
    for share;
    if not found then
      raise exception 'bank transfer is not enabled for this store' using errcode = '22023';
    end if;

    v_payment_reference := 'GD' || upper(encode(extensions.gen_random_bytes(8), 'hex'));
  end if;

  update public.orders
  set fulfillment = 'delivery',
      ghn_shipping_quote = shipping_quote,
      delivery_address = requested_delivery_address,
      delivery_fee_vnd = shipping_fee,
      total_vnd = v_total_vnd,
      payment_method = v_payment_method,
      payment_status = case when v_payment_method = 'bank_transfer' then 'awaiting_payment' else 'unpaid' end,
      payment_reference = v_payment_reference,
      payment_bank_code = v_settings.bank_code,
      payment_bank_name = v_settings.bank_name,
      payment_account_number = v_settings.account_number,
      payment_account_name = v_settings.account_name
  where id = v_order.id;

  return v_result || jsonb_build_object(
    'fulfillment', 'delivery',
    'delivery_address', requested_delivery_address,
    'delivery_distance_m', null,
    'delivery_fee_vnd', shipping_fee,
    'total_vnd', v_total_vnd,
    'payment_method', v_payment_method,
    'payment_status', case when v_payment_method = 'bank_transfer' then 'awaiting_payment' else 'unpaid' end,
    'payment_reference', v_payment_reference,
    'payment_bank_code', v_settings.bank_code,
    'payment_bank_name', v_settings.bank_name,
    'payment_account_number', v_settings.account_number,
    'payment_account_name', v_settings.account_name
  );
end;
$$;
revoke all on function public.create_ghn_delivery_order(text,text,text,text,jsonb,text,text,jsonb,bigint) from public, anon, authenticated;

create function public.create_ghn_checkout_order(
  requested_store_slug text,
  requested_customer_name text,
  requested_customer_phone text,
  requested_customer_note text,
  requested_items jsonb,
  requested_payment_method text,
  requested_fulfillment text,
  requested_delivery_address text,
  requested_delivery_latitude double precision,
  requested_delivery_longitude double precision,
  requested_customer_email text,
  requested_promotion_code text,
  requested_quote_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_order public.orders%rowtype;
  v_promotion public.store_promotions%rowtype;
  v_code text := upper(trim(coalesce(requested_promotion_code, '')));
  v_today date := timezone('Asia/Ho_Chi_Minh', now())::date;
  v_discount bigint;
  v_total bigint;
  v_quote public.ghn_checkout_quotes%rowtype;
  v_email text := lower(trim(coalesce(requested_customer_email, '')));
begin
  if requested_fulfillment is distinct from 'delivery'
    or v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}$'
    or length(v_email) > 254 then
    raise exception 'invalid GHN checkout details' using errcode = '22023';
  end if;

  select q.* into v_quote
  from public.ghn_checkout_quotes q
  join public.stores s on s.id = q.store_id
  join public.store_ghn_connections c on c.store_id = q.store_id and c.shop_id = q.shop_id
  join public.store_ghn_packaging p on p.store_id = q.store_id
  where q.id = requested_quote_id and s.slug = lower(trim(requested_store_slug))
    and s.delivery_enabled and q.expires_at > now() and q.redeemed_at is null
    and q.items = requested_items
    and length(requested_delivery_address) between 5 and 500
    and q.address_hash = encode(sha256(convert_to(requested_delivery_address, 'UTF8')), 'hex')
  for update of q;
  if not found then
    raise exception 'GHN quote expired or checkout changed' using errcode = '22023';
  end if;

  v_result := public.create_ghn_delivery_order(
    requested_store_slug, requested_customer_name, requested_customer_phone, requested_customer_note,
    requested_items, requested_payment_method, requested_delivery_address, v_quote.snapshot, v_quote.fee_vnd
  );
  update public.orders set customer_email = v_email where public_code = (v_result ->> 'public_code');
  update public.ghn_checkout_quotes set redeemed_at = now() where id = v_quote.id;

  if v_code = '' then
    return v_result || jsonb_build_object('promotion_code', null, 'discount_vnd', 0);
  end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9-]{2,23}$' then
    raise exception 'promotion is unavailable' using errcode = '22023';
  end if;

  select * into v_order
  from public.orders
  where public_code = (v_result ->> 'public_code')
  for update;
  if not found then
    raise exception 'created order was not found' using errcode = 'P0002';
  end if;

  select * into v_promotion
  from public.store_promotions
  where store_id = v_order.store_id
    and code = v_code
  for update;
  if not found
    or not v_promotion.is_active
    or v_promotion.starts_on > v_today
    or (v_promotion.ends_on is not null and v_promotion.ends_on < v_today)
    or (v_promotion.usage_limit is not null and v_promotion.usage_count >= v_promotion.usage_limit)
    or v_order.subtotal_vnd < v_promotion.minimum_subtotal_vnd
    or v_order.subtotal_vnd <= 0 then
    raise exception 'promotion is unavailable' using errcode = '22023';
  end if;

  if v_promotion.discount_type = 'percent' then
    v_discount := greatest(
      1::bigint,
      floor(v_order.subtotal_vnd::numeric * v_promotion.discount_value::numeric / 100)::bigint
    );
  else
    v_discount := least(v_order.subtotal_vnd, v_promotion.discount_value);
  end if;
  v_discount := least(v_order.subtotal_vnd, v_discount);
  v_total := v_order.subtotal_vnd + v_order.delivery_fee_vnd - v_discount;

  if v_order.payment_method = 'bank_transfer' and v_total <= 0 then
    raise exception 'promotion makes bank transfer total zero' using errcode = '22023';
  end if;

  update public.orders
  set promotion_code = v_code,
      discount_vnd = v_discount,
      total_vnd = v_total
  where id = v_order.id;

  update public.store_promotions
  set usage_count = usage_count + 1
  where id = v_promotion.id;

  return v_result || jsonb_build_object(
    'promotion_code', v_code,
    'discount_vnd', v_discount,
    'total_vnd', v_total
  );
end;
$$;
revoke all on function public.create_ghn_checkout_order(text,text,text,text,jsonb,text,text,text,double precision,double precision,text,text,uuid) from public, anon, authenticated;
grant execute on function public.create_ghn_checkout_order(text,text,text,text,jsonb,text,text,text,double precision,double precision,text,text,uuid) to anon, authenticated;

create function public.store_ghn_checkout_enabled(target_store uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.stores s
    join public.store_ghn_connections c on c.store_id = s.id
    join public.store_ghn_packaging p on p.store_id = s.id
    where s.id = target_store and s.status = 'active' and s.delivery_enabled
  );
$$;
revoke all on function public.store_ghn_checkout_enabled(uuid) from public, anon, authenticated;
grant execute on function public.store_ghn_checkout_enabled(uuid) to anon, authenticated;

commit;
