-- Guest checkout with pickup/delivery and server-side delivery-radius checks.

alter table public.orders
  add constraint orders_delivery_fields_match_fulfillment_check
  check (
    (
      fulfillment = 'pickup'
      and delivery_address is null
      and delivery_latitude is null
      and delivery_longitude is null
      and delivery_distance_m is null
      and delivery_fee_vnd = 0
    )
    or (
      fulfillment = 'delivery'
      and delivery_address is not null
      and delivery_latitude is not null
      and delivery_longitude is not null
      and delivery_distance_m is not null
    )
  );

create or replace function public.track_guest_order(
  requested_public_code text,
  requested_customer_phone text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'public_code', o.public_code,
    'status', o.status,
    'store_name', s.name,
    'created_at', o.created_at,
    'total_vnd', o.total_vnd,
    'fulfillment', o.fulfillment,
    'delivery_address', o.delivery_address,
    'delivery_distance_m', o.delivery_distance_m,
    'delivery_fee_vnd', o.delivery_fee_vnd,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    'payment_reference', o.payment_reference,
    'payment_bank_code', o.payment_bank_code,
    'payment_bank_name', o.payment_bank_name,
    'payment_account_number', o.payment_account_number,
    'payment_account_name', o.payment_account_name,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'order_item_id', oi.id,
        'name', oi.product_name_snapshot,
        'quantity', oi.quantity,
        'unit_price_vnd', oi.unit_price_snapshot_vnd,
        'review_status', r.status
      ) order by oi.created_at)
      from public.order_items as oi
      left join public.reviews as r on r.order_item_id = oi.id
      where oi.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.orders as o
  join public.stores as s on s.id = o.store_id
  where o.public_code = upper(trim(coalesce(requested_public_code, '')))
    and regexp_replace(o.customer_phone, '[^0-9]', '', 'g') =
      regexp_replace(coalesce(requested_customer_phone, ''), '[^0-9]', '', 'g')
  limit 1;
$$;

create function public.create_guest_order(
  requested_store_slug text,
  requested_customer_name text,
  requested_customer_phone text,
  requested_customer_note text,
  requested_items jsonb,
  requested_payment_method text,
  requested_fulfillment text,
  requested_delivery_address text,
  requested_delivery_latitude double precision,
  requested_delivery_longitude double precision
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_method public.payment_method;
  v_fulfillment public.fulfillment_method;
  v_result jsonb;
  v_order public.orders%rowtype;
  v_store public.stores%rowtype;
  v_settings public.store_payment_methods%rowtype;
  v_payment_reference text;
  v_delivery_fee_vnd bigint := 0;
  v_delivery_distance_m integer;
  v_distance_m double precision;
  v_total_vnd bigint;
  v_delivery_address text;
  v_delivery_latitude double precision;
  v_delivery_longitude double precision;
begin
  if requested_payment_method not in ('cash_on_pickup', 'cash_on_delivery', 'bank_transfer') then
    raise exception 'invalid payment method' using errcode = '22023';
  end if;
  if requested_fulfillment not in ('pickup', 'delivery') then
    raise exception 'invalid fulfillment method' using errcode = '22023';
  end if;

  if requested_payment_method = 'cash_on_delivery' and requested_fulfillment <> 'delivery' then
    raise exception 'cash on delivery requires delivery fulfillment' using errcode = '22023';
  end if;
  if requested_payment_method = 'cash_on_pickup' and requested_fulfillment = 'delivery' then
    v_payment_method := 'cash_on_delivery'::public.payment_method;
  else
    v_payment_method := requested_payment_method::public.payment_method;
  end if;
  v_fulfillment := requested_fulfillment::public.fulfillment_method;

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

  if v_fulfillment = 'delivery' then
    v_delivery_address := trim(coalesce(requested_delivery_address, ''));
    if length(v_delivery_address) not between 5 and 500
      or requested_delivery_latitude is null
      or requested_delivery_longitude is null
      or requested_delivery_latitude not between -90 and 90
      or requested_delivery_longitude not between -180 and 180 then
      raise exception 'invalid delivery details' using errcode = '22023';
    end if;

    select * into v_store
    from public.stores
    where id = v_order.store_id
    for share;
    if not found or not v_store.delivery_enabled or v_store.location is null then
      raise exception 'store delivery is unavailable' using errcode = '22023';
    end if;

    v_distance_m := extensions.st_distance(
      v_store.location,
      extensions.st_setsrid(
        extensions.st_makepoint(requested_delivery_longitude, requested_delivery_latitude),
        4326
      )::extensions.geography
    );
    if v_distance_m > v_store.delivery_radius_m then
      raise exception 'delivery location is outside the store delivery radius' using errcode = '22023';
    end if;

    v_delivery_fee_vnd := v_store.delivery_fee_vnd;
    v_delivery_distance_m := round(v_distance_m)::integer;
    v_delivery_latitude := requested_delivery_latitude;
    v_delivery_longitude := requested_delivery_longitude;
  end if;

  v_total_vnd := v_order.subtotal_vnd + v_delivery_fee_vnd;
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
  set fulfillment = v_fulfillment,
      delivery_address = v_delivery_address,
      delivery_latitude = v_delivery_latitude,
      delivery_longitude = v_delivery_longitude,
      delivery_distance_m = v_delivery_distance_m,
      delivery_fee_vnd = v_delivery_fee_vnd,
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
    'fulfillment', v_fulfillment,
    'delivery_address', v_delivery_address,
    'delivery_distance_m', v_delivery_distance_m,
    'delivery_fee_vnd', v_delivery_fee_vnd,
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

create or replace function public.store_update_order_status(
  requested_store_id uuid,
  requested_order_id uuid,
  requested_status public.order_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_transition_allowed boolean := false;
begin
  if not (select public.has_store_role(requested_store_id))
    and not (select public.is_platform_admin()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_order
  from public.orders
  where id = requested_order_id and store_id = requested_store_id
  for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  v_transition_allowed :=
    (v_order.status = 'pending' and requested_status in ('confirmed', 'rejected', 'cancelled'))
    or (v_order.status = 'confirmed' and requested_status in ('preparing', 'cancelled'))
    or (v_order.status = 'preparing' and requested_status in ('ready', 'cancelled'))
    or (
      v_order.status = 'ready'
      and (
        (v_order.fulfillment = 'pickup' and requested_status = 'completed')
        or (v_order.fulfillment = 'delivery' and requested_status = 'out_for_delivery')
      )
    )
    or (v_order.status = 'out_for_delivery' and v_order.fulfillment = 'delivery' and requested_status = 'completed');

  if not v_transition_allowed then
    raise exception 'invalid order status transition' using errcode = '22023';
  end if;

  update public.orders set status = requested_status where id = requested_order_id;
end;
$$;

revoke execute on function public.track_guest_order(text, text) from public;
revoke execute on function public.create_guest_order(text, text, text, text, jsonb, text, text, text, double precision, double precision) from public;

grant execute on function public.track_guest_order(text, text) to anon, authenticated;
grant execute on function public.create_guest_order(text, text, text, text, jsonb, text, text, text, double precision, double precision) to anon, authenticated;
