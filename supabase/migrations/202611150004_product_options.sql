-- Merchant-managed required/optional product choices, priced and validated in
-- the same transaction as the guest order.

create table public.product_option_groups (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  product_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 80),
  selection_mode text not null check (selection_mode in ('single', 'multiple')),
  min_selections integer not null default 0 check (min_selections >= 0),
  max_selections integer not null default 1 check (max_selections between 1 and 20),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (id, store_id),
  foreign key (product_id, store_id)
    references public.products (id, store_id) on delete cascade,
  check (min_selections <= max_selections),
  check ((selection_mode = 'single' and max_selections = 1) or selection_mode = 'multiple')
);

create table public.product_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  store_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 80),
  price_adjustment_vnd bigint not null default 0 check (price_adjustment_vnd between 0 and 1000000000),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  foreign key (group_id, store_id)
    references public.product_option_groups (id, store_id) on delete cascade
);

create index product_option_groups_product_idx
  on public.product_option_groups (product_id, sort_order, id);
create index product_options_group_idx
  on public.product_options (group_id, sort_order, id);

alter table public.product_option_groups enable row level security;
alter table public.product_options enable row level security;

create policy product_option_groups_read_active on public.product_option_groups
  for select to anon, authenticated
  using (
    public.has_store_role(store_id)
    or public.is_platform_admin()
    or exists (
      select 1
      from public.products as p
      join public.stores as s on s.id = p.store_id
      where p.id = product_option_groups.product_id
        and p.store_id = product_option_groups.store_id
        and p.status = 'active'
        and s.status = 'active'
    )
  );

create policy product_options_read_active on public.product_options
  for select to anon, authenticated
  using (
    public.has_store_role(store_id)
    or public.is_platform_admin()
    or exists (
      select 1
      from public.product_option_groups as g
      join public.products as p on p.id = g.product_id and p.store_id = g.store_id
      join public.stores as s on s.id = p.store_id
      where g.id = product_options.group_id
        and g.store_id = product_options.store_id
        and p.status = 'active'
        and s.status = 'active'
    )
  );

revoke all on public.product_option_groups, public.product_options from anon, authenticated;
grant select on public.product_option_groups, public.product_options to anon, authenticated;

create function public.store_save_product_option_group(
  requested_product_id uuid,
  requested_group_id uuid,
  requested_name text,
  requested_selection_mode text,
  requested_required boolean,
  requested_options jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_group_id uuid;
  v_option jsonb;
  v_option_name text;
  v_price_text text;
  v_sort_order integer := 0;
  v_group_count integer;
begin
  select store_id into v_store_id
  from public.products
  where id = requested_product_id
  for update;
  if not found then
    raise exception 'product is unavailable' using errcode = 'P0002';
  end if;
  if not (select public.has_store_role(v_store_id))
    and not (select public.is_platform_admin()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if requested_name is null or length(trim(requested_name)) not between 1 and 80
    or requested_selection_mode is null or requested_selection_mode not in ('single', 'multiple')
    or requested_required is null then
    raise exception 'invalid product option group' using errcode = '22023';
  end if;
  if requested_options is null or jsonb_typeof(requested_options) <> 'array' then
    raise exception 'invalid product options' using errcode = '22023';
  end if;
  if jsonb_array_length(requested_options) not between 2 and 20 then
    raise exception 'invalid product options' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(requested_options) as item(value)
    group by lower(trim(coalesce(item.value ->> 'name', '')))
    having count(*) > 1
  ) then
    raise exception 'duplicate product option' using errcode = '22023';
  end if;

  for v_option in select item.value from jsonb_array_elements(requested_options) as item(value) loop
    v_option_name := trim(coalesce(v_option ->> 'name', ''));
    v_price_text := coalesce(v_option ->> 'price_adjustment_vnd', '');
    if jsonb_typeof(v_option) <> 'object'
      or length(v_option_name) not between 1 and 80
      or v_price_text !~ '^[0-9]{1,10}$' then
      raise exception 'invalid product option' using errcode = '22023';
    end if;
    if v_price_text::numeric > 1000000000 then
      raise exception 'invalid product option' using errcode = '22023';
    end if;
  end loop;

  if requested_group_id is null then
    select count(*) into v_group_count
    from public.product_option_groups
    where product_id = requested_product_id and store_id = v_store_id;
    if v_group_count >= 40 then
      raise exception 'too many product option groups' using errcode = '22023';
    end if;
    insert into public.product_option_groups (
      store_id, product_id, name, selection_mode, min_selections, max_selections
    ) values (
      v_store_id, requested_product_id, trim(requested_name), requested_selection_mode,
      case when requested_required then 1 else 0 end,
      case when requested_selection_mode = 'single' then 1 else jsonb_array_length(requested_options) end
    ) returning id into v_group_id;
  else
    select id into v_group_id
    from public.product_option_groups
    where id = requested_group_id
      and product_id = requested_product_id
      and store_id = v_store_id
    for update;
    if not found then
      raise exception 'product option group is unavailable' using errcode = 'P0002';
    end if;
    update public.product_option_groups
    set name = trim(requested_name),
        selection_mode = requested_selection_mode,
        min_selections = case when requested_required then 1 else 0 end,
        max_selections = case when requested_selection_mode = 'single' then 1 else jsonb_array_length(requested_options) end
    where id = v_group_id;
    delete from public.product_options where group_id = v_group_id;
  end if;

  for v_option in select item.value from jsonb_array_elements(requested_options) as item(value) loop
    insert into public.product_options (
      group_id, store_id, name, price_adjustment_vnd, sort_order
    ) values (
      v_group_id, v_store_id, trim(v_option ->> 'name'), (v_option ->> 'price_adjustment_vnd')::bigint, v_sort_order
    );
    v_sort_order := v_sort_order + 1;
  end loop;

  return v_group_id;
end;
$$;

create function public.store_delete_product_option_group(requested_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_store_id uuid;
begin
  select product_id, store_id into v_product_id, v_store_id
  from public.product_option_groups
  where id = requested_group_id;
  if not found then
    raise exception 'product option group is unavailable' using errcode = 'P0002';
  end if;
  if not (select public.has_store_role(v_store_id))
    and not (select public.is_platform_admin()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  perform 1 from public.products where id = v_product_id and store_id = v_store_id for update;
  delete from public.product_option_groups
  where id = requested_group_id and product_id = v_product_id and store_id = v_store_id;
end;
$$;

revoke execute on function public.store_save_product_option_group(uuid, uuid, text, text, boolean, jsonb) from public, anon;
revoke execute on function public.store_delete_product_option_group(uuid) from public, anon;
grant execute on function public.store_save_product_option_group(uuid, uuid, text, text, boolean, jsonb) to authenticated;
grant execute on function public.store_delete_product_option_group(uuid) to authenticated;

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

    v_unit_price := v_product.price_vnd + v_option_total;
    if v_product.stock_quantity is not null then
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

    v_unit_price := v_product.price_vnd + v_option_total;
    v_product_name_snapshot := v_product.name;
    if v_option_labels is not null then
      v_product_name_snapshot := v_product.name || ' (' || v_option_labels || ')';
    end if;
    insert into public.order_items (
      order_id, store_id, product_id, product_name_snapshot,
      unit_price_snapshot_vnd, quantity
    ) values (
      v_order_id, v_store.id, v_product.id, v_product_name_snapshot,
      v_unit_price, v_quantity
    );
  end loop;

  return jsonb_build_object(
    'public_code', v_public_code,
    'status', 'pending',
    'total_vnd', v_subtotal
  );
end;
$$;

-- Keep inventory restoration for rejected/cancelled orders when replacing the
-- checkout RPC in this migration.
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
