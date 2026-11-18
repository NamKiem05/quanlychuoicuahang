-- Variant checkout. Do not apply before deploying a compatible storefront.
begin;
alter table public.products add column variants_enabled boolean not null default false;
alter table public.product_variant_drafts drop constraint product_variant_drafts_stock_quantity_check;
alter table public.product_variant_drafts add constraint product_variant_drafts_stock_quantity_check check (stock_quantity >= 0);
alter table public.order_items add column variant_id uuid references public.product_variant_drafts(id) on delete restrict, add column variant_sku_snapshot text, add column variant_attributes_snapshot jsonb;

-- Keep draft variants on already active legacy products private until the merchant republishes them.
drop trigger prevent_publishing_variant_drafts on public.products;
create or replace function public.prevent_publishing_product_with_variant_drafts() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.variants_enabled then new.variants_enabled := true;
  elsif new.status = 'active' and old.status is distinct from 'active' and exists (select 1 from public.product_variant_drafts v where v.product_id = new.id and v.store_id = new.store_id) then new.variants_enabled := true; new.stock_quantity := null;
  else new.variants_enabled := false; end if;
  if new.variants_enabled then new.stock_quantity := null; end if;
  return new;
end; $$;
create trigger set_product_variant_mode before update on public.products for each row execute function public.prevent_publishing_product_with_variant_drafts();

create function public.prevent_deleting_last_sold_variant() returns trigger language plpgsql security definer set search_path = '' as $$
declare enabled boolean;
begin
  select variants_enabled into enabled from public.products where id = old.product_id and store_id = old.store_id for update;
  if enabled and not exists (select 1 from public.product_variant_drafts where product_id = old.product_id and id <> old.id) then
    raise exception 'cannot delete the last variant of a variant product' using errcode = '23514';
  end if;
  return old;
end; $$;
create trigger protect_last_sold_variant before delete on public.product_variant_drafts for each row execute function public.prevent_deleting_last_sold_variant();

create function public.protect_variant_identity() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.product_id is distinct from old.product_id or new.store_id is distinct from old.store_id then
    raise exception 'variant identity cannot be changed' using errcode = '23514';
  end if;
  return new;
end; $$;
create trigger protect_variant_identity before update on public.product_variant_drafts for each row execute function public.protect_variant_identity();

create function public.get_public_product_variants(target_store uuid) returns table(product_id uuid, id uuid, attributes jsonb, sku text, price_vnd bigint, stock_quantity integer) language sql stable security definer set search_path = '' as $$
  select v.product_id, v.id, v.attributes, v.sku, v.price_vnd, v.stock_quantity from public.product_variant_drafts v join public.products p on p.id=v.product_id and p.store_id=v.store_id join public.stores s on s.id=p.store_id where s.id=target_store and s.status='active' and p.status='active' and p.variants_enabled;
$$;
revoke all on function public.get_public_product_variants(uuid) from public, anon, authenticated;
grant execute on function public.get_public_product_variants(uuid) to anon, authenticated;

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
  v_variant public.product_variant_drafts%rowtype;
  v_option_group record;
  v_option record;
  v_quantity integer;
  v_selected_count integer;
  v_selected_option_ids uuid[];
  v_option_id uuid;
  v_option_id_text text;
  v_option_ids jsonb;
  v_option_total bigint;
  v_unit_price bigint;
  v_option_labels text;
  v_product_name_snapshot text;
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
  if requested_items is null or jsonb_typeof(requested_items) <> 'array' then
    raise exception 'invalid items' using errcode = '22023';
  end if;
  if jsonb_array_length(requested_items) not between 1 and 30 then
    raise exception 'invalid items' using errcode = '22023';
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

  -- Product row locks serialize checkout with both stock deductions and
  -- merchant edits to option groups. Stable ordering avoids multi-item deadlocks.
  for v_item in
    select item.value
    from jsonb_array_elements(requested_items) as item(value)
    order by item.value ->> 'product_id', coalesce(item.value -> 'option_ids', '[]'::jsonb)::text
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

    v_option_ids := coalesce(v_item -> 'option_ids', '[]'::jsonb);
    if jsonb_typeof(v_option_ids) <> 'array' then
      raise exception 'invalid product options' using errcode = '22023';
    end if;
    if jsonb_array_length(v_option_ids) > 40 then
      raise exception 'invalid product options' using errcode = '22023';
    end if;

    v_selected_option_ids := array[]::uuid[];
    v_option_total := 0;
    for v_option_id_text in
      select selected.value #>> '{}'
      from jsonb_array_elements(v_option_ids) as selected(value)
      order by selected.value #>> '{}'
    loop
      if coalesce(v_option_id_text, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'invalid product options' using errcode = '22023';
      end if;
      v_option_id := v_option_id_text::uuid;
      if v_option_id = any(v_selected_option_ids) then
        raise exception 'duplicate product option' using errcode = '22023';
      end if;

      select o.id, o.name, o.price_adjustment_vnd, g.id as group_id, g.name as group_name
      into v_option
      from public.product_options as o
      join public.product_option_groups as g on g.id = o.group_id and g.store_id = o.store_id
      where o.id = v_option_id and g.product_id = v_product.id and g.store_id = v_store.id
      for share of o, g;
      if not found then
        raise exception 'product option is unavailable' using errcode = 'P0002';
      end if;

      v_selected_option_ids := array_append(v_selected_option_ids, v_option_id);
      v_option_total := v_option_total + v_option.price_adjustment_vnd;
    end loop;

    for v_option_group in
      select id, min_selections, max_selections
      from public.product_option_groups
      where product_id = v_product.id and store_id = v_store.id
      order by id
      for share
    loop
      select count(*) into v_selected_count
      from public.product_options as o
      where o.group_id = v_option_group.id and o.id = any(v_selected_option_ids);
      if v_selected_count < v_option_group.min_selections or v_selected_count > v_option_group.max_selections then
        raise exception 'product option selection is invalid' using errcode = '22023';
      end if;
    end loop;

    if v_product.variants_enabled then
      if coalesce(v_item ->> 'variant_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'variant selection required' using errcode = '22023';
      end if;
      select * into v_variant from public.product_variant_drafts
      where id = (v_item ->> 'variant_id')::uuid and product_id = v_product.id and store_id = v_store.id for update;
      if not found or v_variant.stock_quantity < v_quantity then
        raise exception 'variant unavailable or out of stock' using errcode = 'P0002';
      end if;
      update public.product_variant_drafts set stock_quantity = stock_quantity - v_quantity where id = v_variant.id;
      v_unit_price := v_variant.price_vnd + v_option_total;
    else
      if v_item ? 'variant_id' and v_item ->> 'variant_id' is not null then
        raise exception 'product does not support variants' using errcode = '22023';
      end if;
      v_unit_price := v_product.price_vnd + v_option_total;
    end if;
    if not v_product.variants_enabled and v_product.stock_quantity is not null then
      if v_product.stock_quantity < v_quantity then
        raise exception 'product is out of stock' using errcode = 'P0002';
      end if;
      update public.products
      set stock_quantity = stock_quantity - v_quantity
      where id = v_product.id;
    end if;
    v_subtotal := v_subtotal + (v_unit_price * v_quantity);
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

    v_option_ids := coalesce(v_item -> 'option_ids', '[]'::jsonb);
    v_selected_option_ids := array[]::uuid[];
    for v_option_id_text in select selected.value #>> '{}' from jsonb_array_elements(v_option_ids) as selected(value) loop
      v_selected_option_ids := array_append(v_selected_option_ids, v_option_id_text::uuid);
    end loop;
    select
      coalesce(sum(o.price_adjustment_vnd), 0),
      string_agg(g.name || ': ' || o.name, ', ' order by g.sort_order, o.sort_order)
    into v_option_total, v_option_labels
    from public.product_options as o
    join public.product_option_groups as g on g.id = o.group_id and g.store_id = o.store_id
    where o.id = any(v_selected_option_ids);

    v_product_name_snapshot := v_product.name;
    if v_product.variants_enabled then
      select * into strict v_variant from public.product_variant_drafts
      where id = (v_item ->> 'variant_id')::uuid and product_id = v_product.id and store_id = v_store.id;
      v_unit_price := v_variant.price_vnd + v_option_total;
      v_product_name_snapshot := v_product_name_snapshot || ' (' ||
        (select string_agg(e.key || ': ' || e.value, ', ' order by e.key) from jsonb_each_text(v_variant.attributes) e) || ')';
    else
      v_unit_price := v_product.price_vnd + v_option_total;
    end if;
    if v_option_labels is not null then
      v_product_name_snapshot := v_product_name_snapshot || ' (' || v_option_labels || ')';
    end if;
    insert into public.order_items (
      order_id, store_id, product_id, product_name_snapshot,
      unit_price_snapshot_vnd, quantity, variant_id, variant_sku_snapshot, variant_attributes_snapshot
    ) values (
      v_order_id, v_store.id, v_product.id, v_product_name_snapshot,
      v_unit_price, v_quantity, case when v_product.variants_enabled then v_variant.id else null end,
      case when v_product.variants_enabled then v_variant.sku else null end,
      case when v_product.variants_enabled then v_variant.attributes else null end
    );
  end loop;

  return jsonb_build_object(
    'public_code', v_public_code,
    'status', 'pending',
    'total_vnd', v_subtotal
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
  v_stock_item record;
  v_transition_allowed boolean := false;
begin
  if not (select public.has_store_role(requested_store_id)) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_order
  from public.orders
  where id = requested_order_id and store_id = requested_store_id
  for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  if v_order.cancellation_request_status = 'pending' and requested_status <> 'cancelled' then
    raise exception 'cancellation request pending' using errcode = '22023';
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
        and oi.variant_id is null
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

  if requested_status in ('rejected', 'cancelled') then
    for v_stock_item in
      select oi.variant_id, sum(oi.quantity) as quantity
      from public.order_items oi where oi.order_id = v_order.id and oi.store_id = requested_store_id and oi.variant_id is not null
      group by oi.variant_id order by oi.variant_id
    loop
      update public.product_variant_drafts set stock_quantity = stock_quantity + v_stock_item.quantity
      where id = v_stock_item.variant_id and store_id = requested_store_id;
    end loop;
  end if;

  update public.orders
  set status = requested_status,
      cancellation_request_status = case
        when requested_status = 'cancelled' and cancellation_request_status = 'pending' then 'approved'
        else cancellation_request_status
      end,
      cancellation_decided_at = case
        when requested_status = 'cancelled' and cancellation_request_status = 'pending' then now()
        else cancellation_decided_at
      end
  where id = requested_order_id;
end;
$$;


commit;
