-- Track optional product inventory and prevent orders from overselling stock.
-- Null stock_quantity means the merchant does not track inventory.

create or replace function public.create_guest_order(
  requested_store_slug text,
  requested_customer_name text,
  requested_customer_phone text,
  requested_customer_note text,
  requested_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype;
  v_order_id uuid;
  v_public_code text;
  v_item jsonb;
  v_product public.products%rowtype;
  v_quantity integer;
  v_subtotal bigint := 0;
  v_phone_digits text;
begin
  if requested_store_slug is null or length(trim(requested_store_slug)) not between 1 and 80 then
    raise exception 'invalid store' using errcode = '22023';
  end if;
  if requested_customer_name is null or length(trim(requested_customer_name)) not between 1 and 120 then
    raise exception 'invalid customer name' using errcode = '22023';
  end if;
  v_phone_digits := regexp_replace(coalesce(requested_customer_phone, ''), '[^0-9]', '', 'g');
  if length(v_phone_digits) not between 9 and 16 then
    raise exception 'invalid customer phone' using errcode = '22023';
  end if;
  if length(coalesce(requested_customer_note, '')) > 500 then
    raise exception 'customer note is too long' using errcode = '22023';
  end if;
  if requested_items is null or jsonb_typeof(requested_items) <> 'array'
    or jsonb_array_length(requested_items) not between 1 and 30 then
    raise exception 'invalid items' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(requested_items) as item(value)
    group by item.value ->> 'product_id'
    having count(*) > 1
  ) then
    raise exception 'duplicate product' using errcode = '22023';
  end if;

  select * into v_store
  from public.stores
  where slug = lower(trim(requested_store_slug))
    and status = 'active'
    and accepts_orders = true
  for share;
  if not found then
    raise exception 'store is unavailable' using errcode = 'P0002';
  end if;

  -- Lock product rows in a stable order so concurrent multi-item checkouts do
  -- not deadlock while competing for inventory.
  for v_item in
    select item.value
    from jsonb_array_elements(requested_items) as item(value)
    order by item.value ->> 'product_id'
  loop
    if jsonb_typeof(v_item) <> 'object'
      or coalesce(v_item ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(v_item ->> 'quantity', '') !~ '^[0-9]{1,2}$' then
      raise exception 'invalid item' using errcode = '22023';
    end if;

    v_quantity := (v_item ->> 'quantity')::integer;
    if v_quantity not between 1 and 20 then
      raise exception 'invalid quantity' using errcode = '22023';
    end if;

    select * into v_product
    from public.products
    where id = (v_item ->> 'product_id')::uuid
      and store_id = v_store.id
      and status = 'active'
    for update;
    if not found then
      raise exception 'product is unavailable' using errcode = 'P0002';
    end if;

    if v_product.stock_quantity is not null then
      if v_product.stock_quantity < v_quantity then
        raise exception 'product is out of stock' using errcode = 'P0002';
      end if;
      update public.products
      set stock_quantity = stock_quantity - v_quantity
      where id = v_product.id;
    end if;

    v_subtotal := v_subtotal + (v_product.price_vnd * v_quantity);
  end loop;

  v_public_code := 'MO-' || upper(encode(extensions.gen_random_bytes(12), 'hex'));
  insert into public.orders (
    store_id, public_code, customer_name, customer_phone, customer_note,
    fulfillment, payment_method, status, subtotal_vnd, total_vnd
  ) values (
    v_store.id, v_public_code, trim(requested_customer_name), trim(requested_customer_phone),
    coalesce(trim(requested_customer_note), ''), 'pickup', 'cash_on_pickup', 'pending',
    v_subtotal, v_subtotal
  ) returning id into v_order_id;

  for v_item in select item.value from jsonb_array_elements(requested_items) as item(value) loop
    v_quantity := (v_item ->> 'quantity')::integer;
    select * into v_product from public.products
    where id = (v_item ->> 'product_id')::uuid
      and store_id = v_store.id
      and status = 'active';

    insert into public.order_items (
      order_id, store_id, product_id, product_name_snapshot,
      unit_price_snapshot_vnd, quantity
    ) values (
      v_order_id, v_store.id, v_product.id, v_product.name,
      v_product.price_vnd, v_quantity
    );
  end loop;

  return jsonb_build_object(
    'public_code', v_public_code,
    'status', 'pending',
    'total_vnd', v_subtotal
  );
end;
$$;

-- Return reserved stock if a merchant rejects or cancels an order.
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
  v_stock_item record;
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

  if requested_status in ('rejected', 'cancelled') then
    for v_stock_item in
      select oi.product_id, sum(oi.quantity) as quantity
      from public.order_items as oi
      where oi.order_id = v_order.id
        and oi.store_id = requested_store_id
        and oi.product_id is not null
      group by oi.product_id
      order by oi.product_id
    loop
      update public.products
      set stock_quantity = least(2147483647::bigint, stock_quantity::bigint + v_stock_item.quantity)::integer
      where id = v_stock_item.product_id
        and store_id = requested_store_id
        and stock_quantity is not null;
    end loop;
  end if;

  update public.orders set status = requested_status where id = requested_order_id;
end;
$$;
