-- Only for a fresh GrowDesk Test database after 202611140001_initial_schema.sql.
-- Does not include the unverified variant checkout migration.
begin;

-- Migration: 202611140002_admin_store_status.sql
-- Let platform admins approve and suspend storefronts without granting owners
-- direct permission to edit the store status column.

create function public.admin_set_store_status(
  requested_store_id uuid,
  requested_status public.store_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.is_platform_admin()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.stores
  set status = requested_status
  where id = requested_store_id;

  if not found then
    raise exception 'store not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.admin_set_store_status(uuid, public.store_status) from public;
revoke execute on function public.admin_set_store_status(uuid, public.store_status) from anon;
grant execute on function public.admin_set_store_status(uuid, public.store_status) to authenticated;


-- Migration: 202611140003_guest_orders.sql
-- Guest checkout and order tracking. The browser can only reach these narrow
-- functions; table writes remain blocked by RLS.

create extension if not exists pgcrypto with schema extensions;

create function public.create_guest_order(
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

  for v_item in select item.value from jsonb_array_elements(requested_items) as item(value) loop
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
    for share;
    if not found then
      raise exception 'product is unavailable' using errcode = 'P0002';
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

create function public.track_guest_order(requested_public_code text, requested_customer_phone text)
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
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', oi.product_name_snapshot,
        'quantity', oi.quantity,
        'unit_price_vnd', oi.unit_price_snapshot_vnd
      ) order by oi.created_at)
      from public.order_items as oi
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

create function public.store_update_order_status(
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
  v_current_status public.order_status;
  v_transition_allowed boolean := false;
begin
  if not (select public.has_store_role(requested_store_id))
    and not (select public.is_platform_admin()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select status into v_current_status
  from public.orders
  where id = requested_order_id and store_id = requested_store_id
  for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  v_transition_allowed :=
    (v_current_status = 'pending' and requested_status in ('confirmed', 'rejected', 'cancelled'))
    or (v_current_status = 'confirmed' and requested_status in ('preparing', 'cancelled'))
    or (v_current_status = 'preparing' and requested_status in ('ready', 'cancelled'))
    or (v_current_status = 'ready' and requested_status = 'completed');

  if not v_transition_allowed then
    raise exception 'invalid order status transition' using errcode = '22023';
  end if;

  update public.orders set status = requested_status where id = requested_order_id;
end;
$$;

revoke execute on function public.create_guest_order(text, text, text, text, jsonb) from public;
revoke execute on function public.track_guest_order(text, text) from public;
revoke execute on function public.store_update_order_status(uuid, uuid, public.order_status) from public;
revoke execute on function public.store_update_order_status(uuid, uuid, public.order_status) from anon;

grant execute on function public.create_guest_order(text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.track_guest_order(text, text) to anon, authenticated;
grant execute on function public.store_update_order_status(uuid, uuid, public.order_status) to authenticated;


-- Migration: 202611140004_guest_reviews.sql
-- Let customers review purchased items after the order is completed.
-- Reviews are submitted through a narrow RPC and moderated by store members.

alter table public.reviews
  add column if not exists product_name_snapshot text;

update public.reviews as r
set product_name_snapshot = oi.product_name_snapshot
from public.order_items as oi
where oi.id = r.order_item_id
  and r.product_name_snapshot is null;

alter table public.reviews
  alter column product_name_snapshot set not null;

drop policy if exists reviews_update_store on public.reviews;
create policy reviews_update_store on public.reviews
  for update to authenticated
  using (
    (select public.has_store_role(store_id))
    or (select public.is_platform_admin())
  )
  with check (
    (select public.has_store_role(store_id))
    or (select public.is_platform_admin())
  );

grant update (status) on public.reviews to authenticated;

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

create or replace function public.create_guest_review(
  requested_public_code text,
  requested_customer_phone text,
  requested_order_item_id uuid,
  requested_rating integer,
  requested_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_customer_name text;
  v_product_id uuid;
  v_product_name text;
  v_body text;
  v_review_id uuid;
begin
  if requested_public_code is null or length(trim(requested_public_code)) not between 1 and 40
    or requested_order_item_id is null
    or requested_rating is null or requested_rating not between 1 and 5 then
    raise exception 'invalid review' using errcode = '22023';
  end if;

  v_body := trim(coalesce(requested_body, ''));
  if length(v_body) > 1000 then
    raise exception 'review is too long' using errcode = '22023';
  end if;

  select o.store_id, o.customer_name, oi.product_id, oi.product_name_snapshot
    into v_store_id, v_customer_name, v_product_id, v_product_name
  from public.orders as o
  join public.order_items as oi on oi.order_id = o.id
  where o.public_code = upper(trim(requested_public_code))
    and regexp_replace(o.customer_phone, '[^0-9]', '', 'g') =
      regexp_replace(coalesce(requested_customer_phone, ''), '[^0-9]', '', 'g')
    and o.status = 'completed'
    and oi.id = requested_order_item_id;

  if not found then
    raise exception 'completed order item not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.reviews where order_item_id = requested_order_item_id
  ) then
    raise exception 'item already reviewed' using errcode = '23505';
  end if;

  insert into public.reviews (
    store_id, order_item_id, product_id, product_name_snapshot,
    display_name, rating, body, status
  ) values (
    v_store_id, requested_order_item_id, v_product_id, v_product_name,
    v_customer_name, requested_rating, v_body, 'pending'
  ) returning id into v_review_id;

  return jsonb_build_object('id', v_review_id, 'status', 'pending');
end;
$$;

revoke execute on function public.create_guest_review(text, text, uuid, integer, text) from public;
revoke execute on function public.track_guest_order(text, text) from public;

grant execute on function public.create_guest_review(text, text, uuid, integer, text) to anon, authenticated;
grant execute on function public.track_guest_order(text, text) to anon, authenticated;


-- Migration: 202611140005_product_images.sql
-- Public product photos with store-scoped upload and delete permissions.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Store members upload product images" on storage.objects;
create policy "Store members upload product images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and (select public.has_store_role((storage.foldername(name))[1]::uuid))
);

drop policy if exists "Store members delete product images" on storage.objects;
create policy "Store members delete product images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-images'
  and (select public.has_store_role((storage.foldername(name))[1]::uuid))
);


-- Migration: 202611140006_store_payment_methods.sql
-- Store-specific bank transfer QR settings and order payment tracking.
-- This migration must be committed before the RPC migration adds the new enum value usage.

alter type public.payment_method add value if not exists 'bank_transfer';

create table public.store_payment_methods (
  store_id uuid primary key references public.stores (id) on delete cascade,
  bank_code text not null check (bank_code = upper(bank_code) and length(bank_code) between 2 and 12),
  bank_name text not null check (length(trim(bank_name)) between 2 and 120),
  account_number text not null check (account_number ~ '^[0-9]{6,30}$'),
  account_name text not null check (length(trim(account_name)) between 2 and 100),
  is_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger store_payment_methods_set_updated_at
  before update on public.store_payment_methods
  for each row execute function public.set_updated_at();

alter table public.store_payment_methods enable row level security;

create policy store_payment_methods_read_enabled_or_member
  on public.store_payment_methods for select to anon, authenticated
  using (
    (
      is_enabled
      and exists (
        select 1 from public.stores as s
        where s.id = store_id and s.status = 'active'
      )
    )
    or (select public.has_store_role(store_id))
    or (select public.is_platform_admin())
  );

create policy store_payment_methods_insert_owner
  on public.store_payment_methods for insert to authenticated
  with check (
    (select public.has_store_role(store_id, array['owner']::public.store_member_role[]))
    or (select public.is_platform_admin())
  );

create policy store_payment_methods_update_owner
  on public.store_payment_methods for update to authenticated
  using (
    (select public.has_store_role(store_id, array['owner']::public.store_member_role[]))
    or (select public.is_platform_admin())
  )
  with check (
    (select public.has_store_role(store_id, array['owner']::public.store_member_role[]))
    or (select public.is_platform_admin())
  );

revoke all on public.store_payment_methods from public;
grant select on public.store_payment_methods to anon, authenticated;
grant insert, update on public.store_payment_methods to authenticated;

alter table public.orders
  add column payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'awaiting_payment', 'paid')),
  add column payment_reference text,
  add column payment_bank_code text,
  add column payment_bank_name text,
  add column payment_account_number text,
  add column payment_account_name text,
  add column payment_confirmed_at timestamptz,
  add column payment_confirmed_by uuid references auth.users (id) on delete set null;

create unique index orders_payment_reference_uidx
  on public.orders (payment_reference)
  where payment_reference is not null;

create index orders_store_payment_status_idx
  on public.orders (store_id, payment_status, created_at desc);


-- Migration: 202611140007_guest_bank_transfer_orders.sql
-- Create dynamic VietQR orders using a store's enabled account and allow the
-- store to manually confirm that the transfer arrived.

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
  requested_payment_method text
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
begin
  if requested_payment_method not in ('cash_on_pickup', 'bank_transfer') then
    raise exception 'invalid payment method' using errcode = '22023';
  end if;
  v_payment_method := requested_payment_method::public.payment_method;

  -- The original narrow RPC remains the single source of truth for validating
  -- the store, products, quantities and customer details.
  v_result := public.create_guest_order(
    requested_store_slug,
    requested_customer_name,
    requested_customer_phone,
    requested_customer_note,
    requested_items
  );

  if v_payment_method = 'cash_on_pickup' then
    return v_result || jsonb_build_object(
      'payment_method', 'cash_on_pickup',
      'payment_status', 'unpaid'
    );
  end if;

  select * into v_order
  from public.orders
  where public_code = (v_result ->> 'public_code')
  for update;
  if not found then
    raise exception 'created order was not found' using errcode = 'P0002';
  end if;
  if v_order.total_vnd <= 0 then
    raise exception 'bank transfer order must have a positive amount' using errcode = '22023';
  end if;

  select * into v_settings
  from public.store_payment_methods
  where store_id = v_order.store_id and is_enabled = true
  for share;
  if not found then
    raise exception 'bank transfer is not enabled for this store' using errcode = '22023';
  end if;

  -- Keep this short, unique, and easy to type from a bank transfer receipt.
  v_payment_reference := 'GD' || upper(encode(extensions.gen_random_bytes(8), 'hex'));

  update public.orders
  set payment_method = v_payment_method,
      payment_status = 'awaiting_payment',
      payment_reference = v_payment_reference,
      payment_bank_code = v_settings.bank_code,
      payment_bank_name = v_settings.bank_name,
      payment_account_number = v_settings.account_number,
      payment_account_name = v_settings.account_name
  where id = v_order.id;

  return v_result || jsonb_build_object(
    'payment_method', 'bank_transfer',
    'payment_status', 'awaiting_payment',
    'payment_reference', v_payment_reference,
    'payment_bank_code', v_settings.bank_code,
    'payment_bank_name', v_settings.bank_name,
    'payment_account_number', v_settings.account_number,
    'payment_account_name', v_settings.account_name
  );
end;
$$;

create function public.store_confirm_order_payment(
  requested_store_id uuid,
  requested_order_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
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
  if v_order.payment_method <> 'bank_transfer'
    or v_order.payment_status <> 'awaiting_payment'
    or v_order.status in ('cancelled', 'rejected') then
    raise exception 'order is not awaiting bank transfer confirmation' using errcode = '22023';
  end if;

  update public.orders
  set payment_status = 'paid',
      payment_confirmed_at = now(),
      payment_confirmed_by = auth.uid()
  where id = requested_order_id;
end;
$$;

revoke execute on function public.track_guest_order(text, text) from public;
revoke execute on function public.create_guest_order(text, text, text, text, jsonb, text) from public;
revoke execute on function public.store_confirm_order_payment(uuid, uuid) from public;
revoke execute on function public.store_confirm_order_payment(uuid, uuid) from anon;

grant execute on function public.track_guest_order(text, text) to anon, authenticated;
grant execute on function public.create_guest_order(text, text, text, text, jsonb, text) to anon, authenticated;
grant execute on function public.store_confirm_order_payment(uuid, uuid) to authenticated;


-- Migration: 202611140008_store_delivery_settings.sql
-- Store delivery settings and delivery address snapshots on orders.

alter type public.fulfillment_method add value if not exists 'delivery';
alter type public.order_status add value if not exists 'out_for_delivery';
alter type public.payment_method add value if not exists 'cash_on_delivery';

alter table public.stores
  add column delivery_enabled boolean not null default false,
  add column delivery_radius_m integer not null default 5000
    check (delivery_radius_m between 500 and 20000),
  add column delivery_fee_vnd bigint not null default 0
    check (delivery_fee_vnd >= 0);

alter table public.stores
  add constraint stores_delivery_requires_location_check
    check (not delivery_enabled or location is not null);

alter table public.orders
  add column delivery_address text,
  add column delivery_latitude double precision,
  add column delivery_longitude double precision,
  add column delivery_distance_m integer,
  add column delivery_fee_vnd bigint not null default 0
    check (delivery_fee_vnd >= 0);

do $$
declare
  v_constraint_name text;
begin
  select conname into v_constraint_name
  from pg_constraint
  where conrelid = 'public.orders'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%total_vnd = subtotal_vnd%'
  limit 1;

  if v_constraint_name is not null then
    execute format('alter table public.orders drop constraint %I', v_constraint_name);
  end if;
end;
$$;

alter table public.orders
  add constraint orders_total_matches_subtotal_and_delivery_fee
    check (total_vnd = subtotal_vnd + delivery_fee_vnd),
  add constraint orders_delivery_address_length_check
    check (delivery_address is null or length(trim(delivery_address)) between 5 and 500),
  add constraint orders_delivery_coordinates_pair_check
    check ((delivery_latitude is null) = (delivery_longitude is null)),
  add constraint orders_delivery_coordinates_range_check
    check (
      (delivery_latitude is null or delivery_latitude between -90 and 90)
      and (delivery_longitude is null or delivery_longitude between -180 and 180)
    ),
  add constraint orders_delivery_distance_check
    check (delivery_distance_m is null or delivery_distance_m >= 0);


-- Migration: 202611140009_guest_delivery_orders.sql
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


-- Migration: 202611140010_grant_store_delivery_settings.sql
-- Allow authenticated store owners to update delivery settings.
-- The existing stores_update_owner RLS policy still limits which store rows
-- can be changed; this grants column-level SQL privileges only.
grant update (delivery_enabled, delivery_radius_m, delivery_fee_vnd)
  on public.stores to authenticated;


-- Migration: 202611140011_enable_order_realtime.sql
-- Publish new order inserts so an authenticated store dashboard can receive them.
-- Row Level Security still limits each subscriber to stores they can read.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'orders'
    ) then
    execute 'alter publication supabase_realtime add table public.orders';
  end if;
end;
$$;


-- Migration: 202611140012_store_location_coordinates.sql
-- Give a store owner the saved point so their map picker can open on the current pin.
create or replace function public.get_store_location_coordinates(requested_store_id uuid)
returns table(latitude double precision, longitude double precision)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    extensions.st_y(s.location::extensions.geometry),
    extensions.st_x(s.location::extensions.geometry)
  from public.stores as s
  where s.id = requested_store_id
    and s.location is not null
    and public.has_store_role(s.id, array['owner']::public.store_member_role[])
  limit 1;
$$;

revoke all on function public.get_store_location_coordinates(uuid) from public, anon;
grant execute on function public.get_store_location_coordinates(uuid) to authenticated;


-- Migration: 202611150001_order_email_confirmation.sql
-- Store a customer's email with the order and provide a narrow lookup for the
-- server-side order confirmation email endpoint.

alter table public.orders
  add column customer_email text;

alter table public.orders
  add constraint orders_customer_email_format_check
  check (
    customer_email is null
    or (
      length(trim(customer_email)) between 3 and 254
      and trim(customer_email) ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
    )
  );

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
  requested_delivery_longitude double precision,
  requested_customer_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(requested_customer_email, '')));
  v_result jsonb;
begin
  if length(v_email) not between 3 and 254
    or v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'invalid customer email' using errcode = '22023';
  end if;

  v_result := public.create_guest_order(
    requested_store_slug,
    requested_customer_name,
    requested_customer_phone,
    requested_customer_note,
    requested_items,
    requested_payment_method,
    requested_fulfillment,
    requested_delivery_address,
    requested_delivery_latitude,
    requested_delivery_longitude
  );

  update public.orders
  set customer_email = v_email
  where public_code = (v_result ->> 'public_code');

  return v_result;
end;
$$;

create function public.get_order_confirmation_details(
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
    'customer_email', o.customer_email,
    'customer_name', o.customer_name,
    'store_name', s.name,
    'total_vnd', o.total_vnd
  )
  from public.orders as o
  join public.stores as s on s.id = o.store_id
  where o.public_code = upper(trim(coalesce(requested_public_code, '')))
    and regexp_replace(o.customer_phone, '[^0-9]', '', 'g') =
      regexp_replace(coalesce(requested_customer_phone, ''), '[^0-9]', '', 'g')
    and o.customer_email is not null
  limit 1;
$$;

-- New guest orders must use the email-requiring entry point. Older overloads
-- remain available only to the security-definer wrapper above.
revoke execute on function public.create_guest_order(text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.create_guest_order(text, text, text, text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.create_guest_order(text, text, text, text, jsonb, text, text, text, double precision, double precision) from public, anon, authenticated;
revoke execute on function public.create_guest_order(text, text, text, text, jsonb, text, text, text, double precision, double precision, text) from public;
revoke execute on function public.get_order_confirmation_details(text, text) from public;

grant execute on function public.create_guest_order(text, text, text, text, jsonb, text, text, text, double precision, double precision, text) to anon, authenticated;
grant execute on function public.get_order_confirmation_details(text, text) to anon, authenticated;


-- Migration: 202611150002_store_promotions.sql
-- Store-managed coupon codes with server-side price calculation and usage limits.

create table public.store_promotions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9-]{2,23}$'),
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  discount_value bigint not null check (
    (discount_type = 'percent' and discount_value between 1 and 100)
    or (discount_type = 'fixed' and discount_value > 0)
  ),
  minimum_subtotal_vnd bigint not null default 0 check (minimum_subtotal_vnd >= 0),
  starts_on date not null default (timezone('Asia/Ho_Chi_Minh', now())::date),
  ends_on date,
  usage_limit integer check (usage_limit is null or usage_limit > 0),
  usage_count integer not null default 0 check (usage_count >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (store_id, code),
  check (ends_on is null or ends_on >= starts_on),
  check (usage_limit is null or usage_limit >= usage_count)
);

create index store_promotions_store_active_idx
  on public.store_promotions (store_id, is_active, created_at desc);

alter table public.store_promotions enable row level security;

create policy store_promotions_manage_store on public.store_promotions
  for all to authenticated
  using ((select public.has_store_role(store_id)) or (select public.is_platform_admin()))
  with check ((select public.has_store_role(store_id)) or (select public.is_platform_admin()));

revoke all on public.store_promotions from anon, authenticated;
grant select on public.store_promotions to authenticated;
grant insert (store_id, code, discount_type, discount_value, minimum_subtotal_vnd, starts_on, ends_on, usage_limit)
  on public.store_promotions to authenticated;
grant update (is_active) on public.store_promotions to authenticated;

alter table public.orders
  add column promotion_code text,
  add column discount_vnd bigint not null default 0 check (discount_vnd >= 0 and discount_vnd <= subtotal_vnd),
  add constraint orders_promotion_code_discount_pair_check
    check (
      (promotion_code is null and discount_vnd = 0)
      or (promotion_code ~ '^[A-Z0-9][A-Z0-9-]{2,23}$' and discount_vnd > 0)
    );

alter table public.orders
  drop constraint orders_total_matches_subtotal_and_delivery_fee,
  add constraint orders_total_matches_subtotal_delivery_and_discount
    check (total_vnd = subtotal_vnd + delivery_fee_vnd - discount_vnd);

create function public.preview_store_promotion(
  requested_store_slug text,
  requested_promotion_code text,
  requested_subtotal_vnd bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_promotion public.store_promotions%rowtype;
  v_today date := timezone('Asia/Ho_Chi_Minh', now())::date;
  v_discount bigint;
begin
  if requested_subtotal_vnd is null or requested_subtotal_vnd <= 0 then
    raise exception 'promotion is unavailable' using errcode = '22023';
  end if;

  select p.* into v_promotion
  from public.store_promotions as p
  join public.stores as s on s.id = p.store_id
  where s.slug = lower(trim(coalesce(requested_store_slug, '')))
    and s.status = 'active'
    and s.accepts_orders = true
    and p.code = upper(trim(coalesce(requested_promotion_code, '')))
    and p.is_active = true;

  if not found
    or v_promotion.starts_on > v_today
    or (v_promotion.ends_on is not null and v_promotion.ends_on < v_today)
    or (v_promotion.usage_limit is not null and v_promotion.usage_count >= v_promotion.usage_limit)
    or requested_subtotal_vnd < v_promotion.minimum_subtotal_vnd then
    raise exception 'promotion is unavailable' using errcode = '22023';
  end if;

  if v_promotion.discount_type = 'percent' then
    v_discount := greatest(
      1::bigint,
      floor(requested_subtotal_vnd::numeric * v_promotion.discount_value::numeric / 100)::bigint
    );
  else
    v_discount := least(requested_subtotal_vnd, v_promotion.discount_value);
  end if;
  v_discount := least(requested_subtotal_vnd, v_discount);

  return jsonb_build_object(
    'promotion_code', v_promotion.code,
    'discount_vnd', v_discount
  );
end;
$$;

create function public.create_guest_order_with_promotion(
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
  requested_promotion_code text
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
begin
  v_result := public.create_guest_order(
    requested_store_slug,
    requested_customer_name,
    requested_customer_phone,
    requested_customer_note,
    requested_items,
    requested_payment_method,
    requested_fulfillment,
    requested_delivery_address,
    requested_delivery_latitude,
    requested_delivery_longitude,
    requested_customer_email
  );

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

create or replace function public.get_order_confirmation_details(
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
    'customer_email', o.customer_email,
    'customer_name', o.customer_name,
    'store_name', s.name,
    'total_vnd', o.total_vnd,
    'promotion_code', o.promotion_code,
    'discount_vnd', o.discount_vnd
  )
  from public.orders as o
  join public.stores as s on s.id = o.store_id
  where o.public_code = upper(trim(coalesce(requested_public_code, '')))
    and regexp_replace(o.customer_phone, '[^0-9]', '', 'g') =
      regexp_replace(coalesce(requested_customer_phone, ''), '[^0-9]', '', 'g')
    and o.customer_email is not null
  limit 1;
$$;

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
    'promotion_code', o.promotion_code,
    'discount_vnd', o.discount_vnd,
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

revoke execute on function public.preview_store_promotion(text, text, bigint) from public;
revoke execute on function public.create_guest_order_with_promotion(text, text, text, text, jsonb, text, text, text, double precision, double precision, text, text) from public;
revoke execute on function public.track_guest_order(text, text) from public;

grant execute on function public.preview_store_promotion(text, text, bigint) to anon, authenticated;
grant execute on function public.create_guest_order_with_promotion(text, text, text, text, jsonb, text, text, text, double precision, double precision, text, text) to anon, authenticated;
grant execute on function public.track_guest_order(text, text) to anon, authenticated;


-- Migration: 202611150003_product_inventory.sql
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


-- Migration: 202611150004_product_options.sql
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


-- Migration: 202611150005_store_appearance.sql
-- Merchant-controlled storefront brand colors. Logo and banner URLs already
-- exist on stores; they reuse the store-scoped product-images bucket.
alter table public.stores
  add column if not exists theme_preset text not null default 'green';

alter table public.stores
  add constraint stores_theme_preset_check
  check (theme_preset in ('green', 'orange', 'blue', 'rose'));

grant update (theme_preset) on public.stores to authenticated;


-- Migration: 202611150006_storefront_layout.sql
-- Store-owner-controlled ordering and visibility for storefront content.
alter table public.stores
  add column if not exists storefront_layout text not null default 'classic'
    check (storefront_layout in ('classic', 'menu-first', 'story-first')),
  add column if not exists storefront_section_order text[] not null
    default array['hero', 'menu', 'reviews', 'story']::text[],
  add column if not exists storefront_hidden_sections text[] not null default array[]::text[];

alter table public.stores
  add constraint stores_storefront_section_order_check check (
    cardinality(storefront_section_order) = 4
    and storefront_section_order <@ array['hero', 'menu', 'reviews', 'story']::text[]
    and storefront_section_order @> array['hero', 'menu', 'reviews', 'story']::text[]
  ),
  add constraint stores_storefront_hidden_sections_check check (
    cardinality(storefront_hidden_sections) <= 3
    and storefront_hidden_sections <@ array['hero', 'reviews', 'story']::text[]
  );

grant update (storefront_layout, storefront_section_order, storefront_hidden_sections)
  on public.stores to authenticated;


-- Migration: 202611150007_store_domain_verification.sql
-- Add an owner-visible DNS challenge and a public resolver for verified hosts.
alter table public.store_domains
  add column if not exists verification_token text not null
    default replace(gen_random_uuid()::text, '-', '');

create or replace function public.resolve_custom_store_hostname(requested_hostname text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.slug
  from public.store_domains d
  join public.stores s on s.id = d.store_id
  where d.hostname = lower(trim(requested_hostname))
    and d.domain_type = 'custom'
    and d.verification_status = 'verified'
    and s.status = 'active'
  limit 1;
$$;

revoke all on function public.resolve_custom_store_hostname(text) from public;
grant execute on function public.resolve_custom_store_hostname(text)
  to anon, authenticated, service_role;


-- Migration: 202611150008_guest_order_cancellation_requests.sql
alter table public.orders
  add column if not exists cancellation_request_status text not null default 'none'
    check (cancellation_request_status in ('none', 'pending', 'approved', 'declined')),
  add column if not exists cancellation_request_reason text,
  add column if not exists cancellation_requested_at timestamptz,
  add column if not exists cancellation_decided_at timestamptz;

create index if not exists orders_pending_cancellation_requests_idx
  on public.orders (store_id, cancellation_requested_at desc)
  where cancellation_request_status = 'pending';

create or replace function public.request_guest_order_cancellation(
  requested_public_code text,
  requested_customer_phone text,
  requested_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_reason text := btrim(coalesce(requested_reason, ''));
  v_requested_at timestamptz;
begin
  if char_length(v_reason) < 5 or char_length(v_reason) > 500 then
    raise exception 'invalid cancellation reason' using errcode = '22023';
  end if;

  select * into v_order
  from public.orders as o
  where o.public_code = upper(btrim(coalesce(requested_public_code, '')))
    and regexp_replace(o.customer_phone, '[^0-9]', '', 'g') =
      regexp_replace(coalesce(requested_customer_phone, ''), '[^0-9]', '', 'g')
  for update;

  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  if v_order.status not in ('pending', 'confirmed') then
    raise exception 'cancellation unavailable' using errcode = '22023';
  end if;

  if v_order.cancellation_request_status = 'pending' then
    return jsonb_build_object(
      'status', 'pending',
      'reason', v_order.cancellation_request_reason,
      'requested_at', v_order.cancellation_requested_at
    );
  end if;

  if v_order.cancellation_request_status <> 'none' then
    raise exception 'cancellation request already decided' using errcode = '22023';
  end if;

  v_requested_at := now();
  update public.orders
  set cancellation_request_status = 'pending',
      cancellation_request_reason = v_reason,
      cancellation_requested_at = v_requested_at,
      cancellation_decided_at = null
  where id = v_order.id;

  return jsonb_build_object(
    'status', 'pending',
    'reason', v_reason,
    'requested_at', v_requested_at
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

create or replace function public.store_decide_order_cancellation(
  requested_store_id uuid,
  requested_order_id uuid,
  accept_request boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
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

  if v_order.cancellation_request_status <> 'pending'
    or v_order.status not in ('pending', 'confirmed') then
    raise exception 'cancellation request is not pending' using errcode = '22023';
  end if;

  if accept_request then
    perform public.store_update_order_status(requested_store_id, requested_order_id, 'cancelled');
    return 'approved';
  end if;

  update public.orders
  set cancellation_request_status = 'declined',
      cancellation_decided_at = now()
  where id = requested_order_id;

  return 'declined';
end;
$$;

create or replace function public.store_confirm_order_payment(
  requested_store_id uuid,
  requested_order_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
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
  if v_order.cancellation_request_status = 'pending'
    or v_order.payment_method <> 'bank_transfer'
    or v_order.payment_status <> 'awaiting_payment'
    or v_order.status in ('cancelled', 'rejected') then
    raise exception 'order is not awaiting bank transfer confirmation' using errcode = '22023';
  end if;

  update public.orders
  set payment_status = 'paid',
      payment_confirmed_at = now(),
      payment_confirmed_by = auth.uid()
  where id = requested_order_id;
end;
$$;

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
    'promotion_code', o.promotion_code,
    'discount_vnd', o.discount_vnd,
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
    'cancellation_request_status', o.cancellation_request_status,
    'cancellation_request_reason', o.cancellation_request_reason,
    'cancellation_requested_at', o.cancellation_requested_at,
    'cancellation_decided_at', o.cancellation_decided_at,
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

revoke execute on function public.request_guest_order_cancellation(text, text, text) from public;
revoke execute on function public.store_decide_order_cancellation(uuid, uuid, boolean) from public;
revoke execute on function public.track_guest_order(text, text) from public;

grant execute on function public.request_guest_order_cancellation(text, text, text) to anon, authenticated;
grant execute on function public.store_decide_order_cancellation(uuid, uuid, boolean) to authenticated;
grant execute on function public.track_guest_order(text, text) to anon, authenticated;


-- Migration: 202611150009_store_admin_chat.sql
create table public.store_admin_messages (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  sender_role text not null check (sender_role in ('merchant', 'admin')),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index store_admin_messages_store_created_idx
  on public.store_admin_messages (store_id, created_at desc, id desc);

alter table public.store_admin_messages enable row level security;

create policy store_admin_messages_read_related
  on public.store_admin_messages
  for select
  to authenticated
  using (
    (select public.has_store_role(store_id))
    or (select public.is_platform_admin())
  );

revoke all privileges on public.store_admin_messages from anon, authenticated;
grant select on public.store_admin_messages to authenticated;

create function public.send_store_admin_message(
  requested_store_id uuid,
  requested_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender_id uuid := auth.uid();
  v_sender_role text;
  v_body text := btrim(coalesce(requested_body, ''));
  v_message public.store_admin_messages%rowtype;
begin
  if v_sender_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'invalid message length' using errcode = '22023';
  end if;

  if (select public.is_platform_admin()) then
    v_sender_role := 'admin';
  elsif (select public.has_store_role(requested_store_id)) then
    v_sender_role := 'merchant';
  else
    raise exception 'not authorized for this store conversation' using errcode = '42501';
  end if;

  insert into public.store_admin_messages (store_id, sender_id, sender_role, body)
  values (requested_store_id, v_sender_id, v_sender_role, v_body)
  returning * into v_message;

  return jsonb_build_object(
    'id', v_message.id,
    'store_id', v_message.store_id,
    'sender_id', v_message.sender_id,
    'sender_role', v_message.sender_role,
    'body', v_message.body,
    'created_at', v_message.created_at
  );
end;
$$;

revoke all on function public.send_store_admin_message(uuid, text) from public, anon;
grant execute on function public.send_store_admin_message(uuid, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'store_admin_messages'
    ) then
    alter publication supabase_realtime add table public.store_admin_messages;
  end if;
end;
$$;


-- Migration: 202611150010_sepay_auto_confirmation.sql
-- Receive SePay bank-transfer notifications and confirm matching QR orders.

create table public.store_sepay_webhook_keys (
  store_id uuid primary key references public.stores (id) on delete cascade,
  secret_hash text not null unique check (secret_hash ~ '^[0-9a-f]{64}$'),
  enabled boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.store_sepay_webhook_keys enable row level security;
revoke all on public.store_sepay_webhook_keys from public, anon, authenticated;
grant select, insert, update, delete on public.store_sepay_webhook_keys to service_role;

create table public.bank_transfer_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider = 'sepay'),
  provider_transaction_id text not null,
  store_id uuid not null references public.stores (id) on delete cascade,
  order_id uuid references public.orders (id) on delete set null,
  payment_reference text not null,
  account_number text not null,
  amount_vnd bigint not null check (amount_vnd > 0),
  transfer_content text not null default '',
  result text not null check (result in (
    'confirmed', 'unmatched', 'account_mismatch', 'amount_mismatch',
    'already_paid', 'closed_order'
  )),
  received_at timestamptz not null default now(),
  unique (provider, provider_transaction_id)
);

create index bank_transfer_webhook_events_store_received_idx
  on public.bank_transfer_webhook_events (store_id, received_at desc);

alter table public.bank_transfer_webhook_events enable row level security;
revoke all on public.bank_transfer_webhook_events from public, anon, authenticated;
grant select, insert, update on public.bank_transfer_webhook_events to service_role;

alter table public.orders
  add column payment_confirmation_source text not null default 'manual'
    check (payment_confirmation_source in ('manual', 'sepay'));

create function public.get_store_sepay_webhook_status(requested_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status jsonb;
begin
  if not (select public.has_store_role(requested_store_id))
    and not (select public.is_platform_admin()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'has_key', (k.secret_hash is not null),
    'enabled', coalesce(k.enabled, false)
  )
  into v_status
  from (select requested_store_id as id) as requested
  left join public.store_sepay_webhook_keys as k on k.store_id = requested.id;

  return coalesce(v_status, '{"has_key":false,"enabled":false}'::jsonb);
end;
$$;

create function public.reset_store_sepay_webhook_key(requested_store_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.has_store_role(requested_store_id, array['owner']::public.store_member_role[])) then
    raise exception 'owner role required' using errcode = '42501';
  end if;

  delete from public.store_sepay_webhook_keys
  where store_id = requested_store_id;
end;
$$;

create function public.process_sepay_bank_transfer(
  requested_store_id uuid,
  requested_transaction_id text,
  requested_account_number text,
  requested_amount_vnd bigint,
  requested_transfer_content text,
  requested_payment_reference text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_order public.orders%rowtype;
  v_result text := 'unmatched';
begin
  if requested_store_id is null
    or length(trim(coalesce(requested_transaction_id, ''))) not between 1 and 120
    or length(trim(coalesce(requested_account_number, ''))) not between 1 and 30
    or requested_amount_vnd is null or requested_amount_vnd <= 0
    or length(trim(coalesce(requested_payment_reference, ''))) not between 1 and 80 then
    raise exception 'invalid bank transfer event' using errcode = '22023';
  end if;

  insert into public.bank_transfer_webhook_events (
    provider, provider_transaction_id, store_id, payment_reference,
    account_number, amount_vnd, transfer_content, result
  ) values (
    'sepay', trim(requested_transaction_id), requested_store_id,
    upper(trim(requested_payment_reference)), trim(requested_account_number),
    requested_amount_vnd, left(coalesce(requested_transfer_content, ''), 500), 'unmatched'
  )
  on conflict (provider, provider_transaction_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return 'duplicate';
  end if;

  select * into v_order
  from public.orders
  where store_id = requested_store_id
    and payment_reference = upper(trim(requested_payment_reference))
    and payment_method = 'bank_transfer'
  for update;

  if not found then
    return v_result;
  end if;

  if v_order.payment_account_number <> trim(requested_account_number) then
    v_result := 'account_mismatch';
  elsif v_order.total_vnd <> requested_amount_vnd then
    v_result := 'amount_mismatch';
  elsif v_order.status in ('cancelled', 'rejected') then
    v_result := 'closed_order';
  elsif v_order.payment_status = 'paid' then
    v_result := 'already_paid';
  elsif v_order.payment_status <> 'awaiting_payment' then
    v_result := 'unmatched';
  else
    v_result := 'confirmed';
    update public.orders
    set payment_status = 'paid',
        payment_confirmed_at = now(),
        payment_confirmed_by = null,
        payment_confirmation_source = 'sepay'
    where id = v_order.id;
  end if;

  update public.bank_transfer_webhook_events
  set order_id = v_order.id,
      result = v_result
  where id = v_event_id;

  return v_result;
end;
$$;

revoke all on function public.get_store_sepay_webhook_status(uuid) from public, anon;
grant execute on function public.get_store_sepay_webhook_status(uuid) to authenticated;

revoke all on function public.reset_store_sepay_webhook_key(uuid) from public, anon;
grant execute on function public.reset_store_sepay_webhook_key(uuid) to authenticated;

revoke all on function public.process_sepay_bank_transfer(uuid, text, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.process_sepay_bank_transfer(uuid, text, text, bigint, text, text) to service_role;


-- Migration: 202611160001_cash_payment_paid_on_completion.sql
-- Mark cash orders as paid when the store completes fulfillment.
-- Bank-transfer orders still require explicit payment confirmation.

create or replace function public.set_cash_payment_paid_on_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'completed'
    and old.status is distinct from new.status
    and new.payment_method in ('cash_on_pickup', 'cash_on_delivery')
    and new.payment_status is distinct from 'paid' then
    new.payment_status := 'paid';
    new.payment_confirmed_at := coalesce(new.payment_confirmed_at, now());
    new.payment_confirmed_by := coalesce(new.payment_confirmed_by, auth.uid());
  end if;

  return new;
end;
$$;

drop trigger if exists orders_mark_cash_paid_on_completion on public.orders;
create trigger orders_mark_cash_paid_on_completion
  before update of status on public.orders
  for each row
  execute function public.set_cash_payment_paid_on_completion();

-- Repair cash orders that were already completed before this rule existed.
update public.orders
set payment_status = 'paid',
    payment_confirmed_at = coalesce(payment_confirmed_at, updated_at)
where status = 'completed'
  and payment_method in ('cash_on_pickup', 'cash_on_delivery')
  and payment_status <> 'paid';


-- Migration: 202611160002_platform_admin_read_only_orders.sql
-- Platform admins can inspect every order, but only store members can mutate orders.
-- Store members who also happen to be platform admins retain access for their own stores.

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

create or replace function public.store_decide_order_cancellation(
  requested_store_id uuid,
  requested_order_id uuid,
  accept_request boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
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

  if v_order.cancellation_request_status <> 'pending'
    or v_order.status not in ('pending', 'confirmed') then
    raise exception 'cancellation request is not pending' using errcode = '22023';
  end if;

  if accept_request then
    perform public.store_update_order_status(requested_store_id, requested_order_id, 'cancelled');
    return 'approved';
  end if;

  update public.orders
  set cancellation_request_status = 'declined',
      cancellation_decided_at = now()
  where id = requested_order_id;

  return 'declined';
end;
$$;

create or replace function public.store_confirm_order_payment(
  requested_store_id uuid,
  requested_order_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
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
  if v_order.cancellation_request_status = 'pending'
    or v_order.payment_method <> 'bank_transfer'
    or v_order.payment_status <> 'awaiting_payment'
    or v_order.status in ('cancelled', 'rejected') then
    raise exception 'order is not awaiting bank transfer confirmation' using errcode = '22023';
  end if;

  update public.orders
  set payment_status = 'paid',
      payment_confirmed_at = now(),
      payment_confirmed_by = auth.uid()
  where id = requested_order_id;
end;
$$;


-- Migration: 202611160003_overview_revenue.sql
create or replace function public.get_overview_revenue(p_store_id uuid default null)
returns table (revenue_day date, revenue_vnd bigint, paid_orders bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with period as (
    select (now() at time zone 'Asia/Ho_Chi_Minh')::date as today
  ),
  totals as (
    select
      (o.payment_confirmed_at at time zone 'Asia/Ho_Chi_Minh')::date as day,
      sum(o.total_vnd)::bigint as revenue_vnd,
      count(*) as paid_orders
    from public.orders o
    cross join period p
    where o.payment_status = 'paid'
      and o.status not in ('cancelled', 'rejected')
      and (p_store_id is null or o.store_id = p_store_id)
      and o.payment_confirmed_at >= ((p.today - 6)::timestamp at time zone 'Asia/Ho_Chi_Minh')
      and o.payment_confirmed_at < ((p.today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
    group by 1
  )
  select p.today - d.days_ago, coalesce(t.revenue_vnd, 0), coalesce(t.paid_orders, 0)
  from period p
  cross join generate_series(0, 6) as d(days_ago)
  left join totals t on t.day = p.today - d.days_ago
  order by 1;
$$;

revoke execute on function public.get_overview_revenue(uuid) from public, anon;
grant execute on function public.get_overview_revenue(uuid) to authenticated;


-- Migration: 202611160004_overview_revenue_date_range.sql
create or replace function public.get_overview_revenue(
  p_store_id uuid, p_start_date date, p_end_date date
)
returns table (revenue_day date, revenue_vnd bigint, paid_orders bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with period as (
    select p_start_date as first_day, p_end_date as last_day
    where p_end_date - p_start_date between 0 and 365
  ),
  totals as (
    select
      (o.payment_confirmed_at at time zone 'Asia/Ho_Chi_Minh')::date as day,
      sum(o.total_vnd)::bigint as revenue_vnd,
      count(*) as paid_orders
    from public.orders o
    cross join period p
    where o.payment_status = 'paid'
      and o.status not in ('cancelled', 'rejected')
      and (p_store_id is null or o.store_id = p_store_id)
      and o.payment_confirmed_at >= (p.first_day::timestamp at time zone 'Asia/Ho_Chi_Minh')
      and o.payment_confirmed_at < ((p.last_day + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
    group by 1
  )
  select p.first_day + d.day_offset, coalesce(t.revenue_vnd, 0), coalesce(t.paid_orders, 0)
  from period p
  cross join lateral generate_series(0, p.last_day - p.first_day) as d(day_offset)
  left join totals t on t.day = p.first_day + d.day_offset
  order by 1;
$$;

revoke execute on function public.get_overview_revenue(uuid, date, date) from public, anon;
grant execute on function public.get_overview_revenue(uuid, date, date) to authenticated;

create or replace function public.get_overview_revenue(p_store_id uuid default null)
returns table (revenue_day date, revenue_vnd bigint, paid_orders bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.*
  from (select (now() at time zone 'Asia/Ho_Chi_Minh')::date as today) p
  cross join lateral public.get_overview_revenue(p_store_id, p.today - 6, p.today) r;
$$;


-- Migration: 202611160005_store_best_selling_products.sql
create or replace function public.get_store_best_selling_products(
  p_store_id uuid, p_start_date date, p_end_date date
)
returns table (product_name text, quantity_sold bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with product_totals as (
    select
      i.product_id,
      case when i.product_id is null then i.product_name_snapshot end as deleted_name,
      max(i.product_name_snapshot) as snapshot_name,
      sum(i.quantity) as units
    from public.orders o
    join public.order_items i on i.order_id = o.id and i.store_id = o.store_id
    where o.store_id = p_store_id
      and p_end_date - p_start_date between 0 and 365
      and o.payment_status = 'paid'
      and o.status not in ('cancelled', 'rejected')
      and o.payment_confirmed_at >= (p_start_date::timestamp at time zone 'Asia/Ho_Chi_Minh')
      and o.payment_confirmed_at < ((p_end_date + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
    group by i.product_id, deleted_name
  )
  select coalesce(p.name, t.snapshot_name), t.units
  from product_totals t
  left join public.products p on p.id = t.product_id and p.store_id = p_store_id
  order by t.units desc, 1, t.product_id, t.deleted_name
  limit 5;
$$;

revoke execute on function public.get_store_best_selling_products(uuid, date, date) from public, anon;
grant execute on function public.get_store_best_selling_products(uuid, date, date) to authenticated;


-- Migration: 202611160006_signup_profile_phone.sql
create or replace function public.create_profile_for_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  signup_phone text := new.raw_user_meta_data ->> 'phone';
begin
  insert into public.profiles (id, display_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1)),
    case when signup_phone ~ '^[+]?[0-9]{8,15}$' then signup_phone end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Recover phone numbers submitted before this migration without overwriting profile edits.
update public.profiles p
set phone = u.raw_user_meta_data ->> 'phone'
from auth.users u
where p.id = u.id
  and p.phone is null
  and (u.raw_user_meta_data ->> 'phone') ~ '^[+]?[0-9]{8,15}$';


-- Migration: 202611160007_low_stock_alerts.sql
alter table public.products
  add column if not exists low_stock_threshold integer not null default 5
  check (low_stock_threshold >= 0);

create or replace function public.get_store_low_stock_products(p_store_id uuid)
returns table (id uuid, name text, stock_quantity integer, low_stock_threshold integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, p.name, p.stock_quantity, p.low_stock_threshold
  from public.products p
  where p.store_id = p_store_id
    and ((select public.has_store_role(p_store_id)) or (select public.is_platform_admin()))
    and p.status = 'active'
    and p.stock_quantity <= p.low_stock_threshold
  order by p.stock_quantity, p.name, p.id
  limit 10;
$$;

revoke execute on function public.get_store_low_stock_products(uuid) from public, anon;
grant execute on function public.get_store_low_stock_products(uuid) to authenticated;


-- Migration: 202611160008_store_order_hours.sql
create function public.valid_store_order_hours(schedule jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  entry jsonb;
begin
  if jsonb_typeof(schedule) <> 'array' then return false; end if;
  if jsonb_array_length(schedule) <> 7 then return false; end if;
  for entry in select value from jsonb_array_elements(schedule) loop
    if entry = 'null'::jsonb then continue; end if;
    if jsonb_typeof(entry) <> 'array' then return false; end if;
    if jsonb_array_length(entry) <> 2 then return false; end if;
    if jsonb_typeof(entry->0) <> 'number' or jsonb_typeof(entry->1) <> 'number'
       or (entry->>0) !~ '^[0-9]{1,4}$' or (entry->>1) !~ '^[0-9]{1,4}$' then
      return false;
    end if;
    if (entry->>0)::integer >= 1440 or (entry->>1)::integer >= 1440 or entry->0 = entry->1 then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

alter table public.stores
  add column order_hours jsonb check (order_hours is null or public.valid_store_order_hours(order_hours));
grant update (order_hours) on public.stores to authenticated;

create function public.enforce_store_order_hours()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  schedule jsonb;
  local_time timestamp := clock_timestamp() at time zone 'Asia/Ho_Chi_Minh';
  weekday integer := extract(dow from local_time)::integer;
  minute integer := extract(hour from local_time)::integer * 60 + extract(minute from local_time)::integer;
  today_hours jsonb;
  previous_hours jsonb;
begin
  select s.order_hours into schedule from public.stores s where s.id = new.store_id;
  if schedule is null then return new; end if;

  today_hours := schedule->weekday;
  previous_hours := schedule->((weekday + 6) % 7);
  if ((today_hours->>0)::integer <= minute
      and ((today_hours->>0)::integer > (today_hours->>1)::integer or minute < (today_hours->>1)::integer))
     or ((previous_hours->>0)::integer > (previous_hours->>1)::integer and minute < (previous_hours->>1)::integer) then
    return new;
  end if;

  raise exception 'store is outside order hours' using errcode = 'P0001';
end;
$$;

create trigger orders_enforce_store_order_hours
  before insert on public.orders
  for each row execute function public.enforce_store_order_hours();


-- Migration: 202611160009_pickup_ready_estimate.sql
alter table public.orders add column estimated_ready_at timestamptz;

create function public.store_set_pickup_ready_estimate(
  requested_store_id uuid,
  requested_order_id uuid,
  requested_minutes integer,
  confirm_order boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  if not (select public.has_store_role(requested_store_id)) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if requested_minutes is null or requested_minutes not in (15, 30, 45) then
    raise exception 'invalid preparation estimate' using errcode = '22023';
  end if;

  select * into v_order from public.orders
  where id = requested_order_id and store_id = requested_store_id
  for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_order.fulfillment <> 'pickup' or v_order.cancellation_request_status = 'pending' then
    raise exception 'cannot estimate preparation for this order' using errcode = '22023';
  end if;

  if confirm_order is true then
    perform public.store_update_order_status(requested_store_id, requested_order_id, 'confirmed');
  elsif v_order.status not in ('confirmed', 'preparing') then
    raise exception 'cannot revise preparation for this order' using errcode = '22023';
  end if;

  update public.orders
  set estimated_ready_at = clock_timestamp() + make_interval(mins => requested_minutes)
  where id = requested_order_id and store_id = requested_store_id;
end;
$$;

revoke execute on function public.store_set_pickup_ready_estimate(uuid, uuid, integer, boolean) from public, anon;
grant execute on function public.store_set_pickup_ready_estimate(uuid, uuid, integer, boolean) to authenticated;


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
    'promotion_code', o.promotion_code,
    'discount_vnd', o.discount_vnd,
    'fulfillment', o.fulfillment,
    'estimated_ready_at', o.estimated_ready_at,
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
    'cancellation_request_status', o.cancellation_request_status,
    'cancellation_request_reason', o.cancellation_request_reason,
    'cancellation_requested_at', o.cancellation_requested_at,
    'cancellation_decided_at', o.cancellation_decided_at,
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


-- Migration: 202611160010_storefront_style_presets.sql
alter table public.stores
  add column storefront_style text not null default 'original'
  check (storefront_style in ('original', 'modern', 'cozy', 'minimal'));

grant update (storefront_style) on public.stores to authenticated;


-- Migration: 202611160011_order_refunds.sql
alter table public.orders
  add column refund_amount_vnd bigint,
  add column refunded_at timestamptz,
  add column refunded_by uuid references auth.users (id) on delete set null,
  add constraint orders_refund_details_check check (
    (refunded_at is null and refund_amount_vnd is null and refunded_by is null)
    or (
      refunded_at is not null
      and refund_amount_vnd is not null
      and refund_amount_vnd > 0
      and refund_amount_vnd = total_vnd
      and payment_method = 'bank_transfer'
      and payment_status = 'paid'
      and status in ('cancelled', 'rejected')
    )
  );

create function public.store_record_order_refund(
  requested_store_id uuid,
  requested_order_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  if not (select public.has_store_role(requested_store_id, array['owner']::public.store_member_role[])) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_order
  from public.orders
  where id = requested_order_id and store_id = requested_store_id
  for update;

  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  if v_order.payment_method <> 'bank_transfer'
    or v_order.payment_status <> 'paid'
    or v_order.status not in ('cancelled', 'rejected')
    or v_order.total_vnd <= 0 then
    raise exception 'order is not eligible for a refund' using errcode = '22023';
  end if;

  if v_order.refunded_at is null then
    update public.orders
    set refund_amount_vnd = v_order.total_vnd,
        refunded_at = clock_timestamp(),
        refunded_by = auth.uid()
    where id = v_order.id;
  end if;
end;
$$;

revoke execute on function public.store_record_order_refund(uuid, uuid) from public, anon;
grant execute on function public.store_record_order_refund(uuid, uuid) to authenticated;

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
    'promotion_code', o.promotion_code,
    'discount_vnd', o.discount_vnd,
    'fulfillment', o.fulfillment,
    'estimated_ready_at', o.estimated_ready_at,
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
    'refund_amount_vnd', o.refund_amount_vnd,
    'refunded_at', o.refunded_at,
    'cancellation_request_status', o.cancellation_request_status,
    'cancellation_request_reason', o.cancellation_request_reason,
    'cancellation_requested_at', o.cancellation_requested_at,
    'cancellation_decided_at', o.cancellation_decided_at,
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


-- Migration: 202611160012_category_images.sql
alter table public.categories
  add column if not exists image_url text;


-- Migration: 202611160013_merchant_plans.sql
create table public.merchant_plan_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  plan text not null check (plan in ('basic', 'plus')),
  amount_vnd integer not null check (
    (plan = 'basic' and amount_vnd = 49000) or (plan = 'plus' and amount_vnd = 99000)
  ),
  transfer_code text not null unique default ('GGP' || upper(left(replace(gen_random_uuid()::text, '-', ''), 16))),
  status text not null default 'pending' check (status in ('pending', 'approved')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  sepay_transaction_id text unique,
  valid_until timestamptz,
  check ((status = 'approved') = (paid_at is not null and sepay_transaction_id is not null and valid_until is not null))
);

create unique index merchant_plan_one_pending on public.merchant_plan_payments (user_id) where status = 'pending';
create index merchant_plan_user_expiry on public.merchant_plan_payments (user_id, valid_until desc) where status = 'approved';

alter table public.merchant_plan_payments enable row level security;
revoke all on public.merchant_plan_payments from public, anon, authenticated;
grant select on public.merchant_plan_payments to authenticated;
create policy merchant_plan_payments_read on public.merchant_plan_payments
  for select to authenticated using (
    user_id = (select auth.uid()) or (select public.is_platform_admin())
  );

-- Existing stores have no billing owner and retain their current permissions.
alter table public.stores add column billing_owner_id uuid unique references auth.users(id) on delete restrict;

create function public.request_merchant_plan(requested_plan text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  buyer uuid := auth.uid();
  current_plan text;
begin
  if buyer is null or requested_plan is null or requested_plan not in ('basic', 'plus') then
    raise exception 'invalid_plan';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(buyer::text, 142));

  if exists (select 1 from public.store_members m
    join public.stores s on s.id = m.store_id
    where m.user_id = buyer and s.billing_owner_id is distinct from buyer) then
    raise exception 'existing_store';
  end if;
  if exists (select 1 from public.merchant_plan_payments where user_id = buyer and status = 'pending') then
    return;
  end if;
  select plan into current_plan from public.merchant_plan_payments
    where user_id = buyer and status = 'approved' and valid_until > now()
    order by valid_until desc limit 1;
  if current_plan is not null and current_plan <> requested_plan then
    raise exception 'active_plan_exists';
  end if;
  insert into public.merchant_plan_payments (user_id, plan, amount_vnd)
    values (buyer, requested_plan, case requested_plan when 'basic' then 49000 else 99000 end);
end;
$$;

create function public.confirm_merchant_plan_transfer(
  payment_code text, received_amount integer, transaction_id text
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  payment public.merchant_plan_payments%rowtype;
  prior_expiry timestamptz;
begin
  if transaction_id is null or char_length(transaction_id) not between 1 and 120 then
    raise exception 'invalid_transaction_id';
  end if;
  select * into payment from public.merchant_plan_payments where transfer_code = payment_code for update;
  if not found then return 'unknown_code'; end if;
  if payment.status <> 'pending' then return 'already_paid'; end if;
  if received_amount is distinct from payment.amount_vnd then return 'amount_mismatch'; end if;

  select max(valid_until) into prior_expiry from public.merchant_plan_payments
    where user_id = payment.user_id and status = 'approved';
  update public.merchant_plan_payments set status = 'approved', paid_at = now(),
    sepay_transaction_id = transaction_id,
    valid_until = greatest(now(), prior_expiry) + interval '1 month'
    where id = payment.id;
  return 'activated';
exception when unique_violation then
  return 'duplicate_transaction';
end;
$$;

create function public.create_store_with_merchant_plan(
  store_name text, store_slug text, store_phone text, store_address text, store_location text
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  buyer uuid := auth.uid();
  new_store uuid;
begin
  if buyer is null then raise exception 'sign_in_required'; end if;
  if store_slug is null or char_length(store_slug) > 80 then
    raise exception 'invalid_store_slug';
  end if;
  if store_slug in ('admin', 'api', 'auth', 'chat', 'dashboard', 'demo', 'login', 'merchant-plan', 'store-host', 'track-order', 'www') then
    raise exception 'reserved_store_slug';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(buyer::text, 142));
  if not exists (select 1 from public.merchant_plan_payments
    where user_id = buyer and status = 'approved' and valid_until > now()) then
    raise exception 'active_plan_required';
  end if;
  if exists (select 1 from public.store_members where user_id = buyer) then
    raise exception 'existing_store';
  end if;
  insert into public.stores (created_by, billing_owner_id, name, slug, phone, address, location, status, accepts_orders)
    values (buyer, buyer, store_name, store_slug, store_phone, store_address, store_location::extensions.geography, 'active', false)
    returning id into new_store;
  insert into public.store_members (store_id, user_id, role) values (new_store, buyer, 'owner');
end;
$$;

drop policy stores_create_draft on public.stores;

create function public.merchant_plan_allows_orders(target_store uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.stores s where s.id = target_store
      and (s.billing_owner_id is null or exists (
        select 1 from public.merchant_plan_payments p
        where p.user_id = s.billing_owner_id and p.status = 'approved' and p.valid_until > now()
      ))
  );
$$;

create function public.enforce_merchant_order_plan()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.merchant_plan_allows_orders(new.store_id) then
    raise exception 'store_plan_expired';
  end if;
  return new;
end;
$$;
create trigger enforce_merchant_order_plan before insert on public.orders
  for each row execute function public.enforce_merchant_order_plan();

create function public.has_merchant_premium(target_store uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or exists (
    select 1 from public.stores s where s.id = target_store and public.has_store_role(s.id) and (
      s.billing_owner_id is null or (
        select p.plan = 'plus' from public.merchant_plan_payments p
        where p.user_id = s.billing_owner_id and p.status = 'approved' and p.valid_until > now()
        order by p.valid_until desc limit 1
      )
    )
  );
$$;

create policy promotions_paid_plan on public.store_promotions as restrictive
  for all to authenticated using ((select public.has_merchant_premium(store_id)))
  with check ((select public.has_merchant_premium(store_id)));

create policy custom_domains_paid_plan_insert on public.store_domains as restrictive
  for insert to authenticated with check (domain_type <> 'custom' or (select public.has_merchant_premium(store_id)));
create policy custom_domains_paid_plan_update on public.store_domains as restrictive
  for update to authenticated using (domain_type <> 'custom' or (select public.has_merchant_premium(store_id)))
  with check (domain_type <> 'custom' or (select public.has_merchant_premium(store_id)));

create function public.enforce_merchant_appearance_plan()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and new.billing_owner_id is distinct from old.billing_owner_id then
    raise exception 'billing_owner_is_read_only';
  end if;
  if current_user = 'authenticated'
    and row(new.logo_url, new.banner_url, new.theme_preset, new.storefront_layout,
      new.storefront_section_order, new.storefront_hidden_sections, new.storefront_style)
      is distinct from row(old.logo_url, old.banner_url, old.theme_preset, old.storefront_layout,
      old.storefront_section_order, old.storefront_hidden_sections, old.storefront_style)
    and not public.has_merchant_premium(old.id) then
    raise exception 'premium_plan_required';
  end if;
  return new;
end;
$$;
create trigger enforce_merchant_appearance_plan before update on public.stores
  for each row execute function public.enforce_merchant_appearance_plan();

revoke all on function public.request_merchant_plan(text),
  public.confirm_merchant_plan_transfer(text, integer, text),
  public.create_store_with_merchant_plan(text, text, text, text, text),
  public.has_merchant_premium(uuid), public.enforce_merchant_appearance_plan(),
  public.merchant_plan_allows_orders(uuid), public.enforce_merchant_order_plan()
  from public, anon, authenticated;
grant execute on function public.request_merchant_plan(text),
  public.create_store_with_merchant_plan(text, text, text, text, text),
  public.has_merchant_premium(uuid) to authenticated;
grant execute on function public.confirm_merchant_plan_transfer(text, integer, text) to service_role;
grant execute on function public.merchant_plan_allows_orders(uuid) to anon, authenticated, service_role;


-- Migration: 202611160014_merchant_plan_upgrades.sql
alter table public.merchant_plan_payments
  add column upgrade_amount_vnd integer check (upgrade_amount_vnd > 0),
  add column upgrade_expires_at timestamptz,
  add check ((upgrade_amount_vnd is null and upgrade_expires_at is null)
    or (plan = 'plus' and upgrade_amount_vnd is not null and upgrade_expires_at is not null)),
  drop constraint merchant_plan_payments_status_check,
  add constraint merchant_plan_payments_status_check check (status in ('pending', 'approved', 'expired'));

create function public.expire_merchant_plan_upgrades(buyer uuid)
returns void language sql set search_path = '' as $$
  update public.merchant_plan_payments set status = 'expired'
  where user_id = buyer and status = 'pending' and upgrade_expires_at <= now();
$$;
revoke all on function public.expire_merchant_plan_upgrades(uuid) from public, anon, authenticated;

create or replace function public.request_merchant_plan(requested_plan text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  buyer uuid := auth.uid();
  current_plan text;
  expiry timestamptz;
  upgrade_price integer;
begin
  if buyer is null or requested_plan is null or requested_plan not in ('basic', 'plus') then
    raise exception 'invalid_plan';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(buyer::text, 142));
  if exists (select 1 from public.store_members m join public.stores s on s.id = m.store_id
    where m.user_id = buyer and s.billing_owner_id is distinct from buyer) then
    raise exception 'existing_store';
  end if;
  perform public.expire_merchant_plan_upgrades(buyer);
  if exists (select 1 from public.merchant_plan_payments where user_id = buyer and status = 'pending') then return; end if;

  select plan, valid_until into current_plan, expiry from public.merchant_plan_payments
    where user_id = buyer and status = 'approved' and valid_until > now()
    order by valid_until desc, plan desc limit 1;
  if current_plan = 'basic' and requested_plan = 'plus' then
    upgrade_price := ceil(50000 * extract(epoch from (expiry - now()))
      / extract(epoch from (expiry - (expiry - interval '1 month'))));
    insert into public.merchant_plan_payments (user_id, plan, amount_vnd, upgrade_amount_vnd, upgrade_expires_at)
      values (buyer, 'plus', 99000, upgrade_price, expiry);
    return;
  end if;
  if current_plan is not null and current_plan <> requested_plan then raise exception 'active_plan_exists'; end if;
  insert into public.merchant_plan_payments (user_id, plan, amount_vnd)
    values (buyer, requested_plan, case requested_plan when 'basic' then 49000 else 99000 end);
end;
$$;

create or replace function public.confirm_merchant_plan_transfer(payment_code text, received_amount integer, transaction_id text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  payment public.merchant_plan_payments%rowtype;
  buyer uuid;
  prior_expiry timestamptz;
begin
  if transaction_id is null or char_length(transaction_id) not between 1 and 120 then
    raise exception 'invalid_transaction_id';
  end if;
  select user_id into buyer from public.merchant_plan_payments where transfer_code = payment_code;
  if not found then return 'unknown_code'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(buyer::text, 142));
  select * into payment from public.merchant_plan_payments where transfer_code = payment_code for update;
  if payment.status = 'approved' then return 'already_paid'; end if;
  if received_amount is distinct from coalesce(payment.upgrade_amount_vnd, payment.amount_vnd) then return 'amount_mismatch'; end if;

  select max(valid_until) into prior_expiry from public.merchant_plan_payments
    where user_id = buyer and status = 'approved';
  update public.merchant_plan_payments set status = 'approved', paid_at = now(),
    sepay_transaction_id = transaction_id,
    valid_until = coalesce(payment.upgrade_expires_at, greatest(now(), prior_expiry) + interval '1 month')
    where id = payment.id;
  if payment.upgrade_expires_at <= now() then return 'upgrade_paid_after_expiry'; end if;
  return 'activated';
exception when unique_violation then
  return 'duplicate_transaction';
end;
$$;

create or replace function public.has_merchant_premium(target_store uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or exists (
    select 1 from public.stores s where s.id = target_store and public.has_store_role(s.id) and (
      s.billing_owner_id is null or (
        select p.plan = 'plus' from public.merchant_plan_payments p
        where p.user_id = s.billing_owner_id and p.status = 'approved' and p.valid_until > now()
        order by p.valid_until desc, p.plan desc limit 1
      )
    )
  );
$$;


-- Migration: 202611160015_cancel_merchant_plan_payment.sql
alter table public.merchant_plan_payments
  add column cancelled_at timestamptz,
  add column received_amount_vnd integer check (received_amount_vnd > 0),
  drop constraint merchant_plan_payments_status_check,
  add constraint merchant_plan_payments_status_check
    check (status in ('pending', 'approved', 'expired', 'cancelled', 'needs_review')),
  add check ((status in ('cancelled', 'needs_review')) = (cancelled_at is not null)),
  add check (status <> 'needs_review' or (paid_at is not null and sepay_transaction_id is not null
    and received_amount_vnd is not null and valid_until is null));

create function public.cancel_merchant_plan_payment(payment_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  buyer uuid := auth.uid();
begin
  if buyer is null then raise exception 'sign_in_required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(buyer::text, 142));
  update public.merchant_plan_payments set status = 'cancelled', cancelled_at = now()
    where user_id = buyer and transfer_code = payment_code and status = 'pending';
  return found;
end;
$$;

revoke all on function public.cancel_merchant_plan_payment(text) from public, anon, authenticated;
grant execute on function public.cancel_merchant_plan_payment(text) to authenticated;

create or replace function public.confirm_merchant_plan_transfer(payment_code text, received_amount integer, transaction_id text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  payment public.merchant_plan_payments%rowtype;
  buyer uuid;
  prior_expiry timestamptz;
begin
  if transaction_id is null or char_length(transaction_id) not between 1 and 120 then
    raise exception 'invalid_transaction_id';
  end if;
  select user_id into buyer from public.merchant_plan_payments where transfer_code = payment_code;
  if not found then return 'unknown_code'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(buyer::text, 142));
  select * into payment from public.merchant_plan_payments where transfer_code = payment_code for update;
  if payment.status in ('approved', 'needs_review') then return 'already_paid'; end if;
  if payment.status = 'cancelled' then
    if received_amount is null or received_amount <= 0 then return 'amount_mismatch'; end if;
    update public.merchant_plan_payments set status = 'needs_review', paid_at = now(),
      sepay_transaction_id = transaction_id, received_amount_vnd = received_amount
      where id = payment.id;
    return 'cancelled_payment_needs_review';
  end if;
  if received_amount is distinct from coalesce(payment.upgrade_amount_vnd, payment.amount_vnd) then return 'amount_mismatch'; end if;

  select max(valid_until) into prior_expiry from public.merchant_plan_payments
    where user_id = buyer and status = 'approved';
  update public.merchant_plan_payments set status = 'approved', paid_at = now(),
    sepay_transaction_id = transaction_id,
    valid_until = coalesce(payment.upgrade_expires_at, greatest(now(), prior_expiry) + interval '1 month')
    where id = payment.id;
  if payment.upgrade_expires_at <= now() then return 'upgrade_paid_after_expiry'; end if;
  return 'activated';
exception when unique_violation then
  return 'duplicate_transaction';
end;
$$;


-- Migration: 202611160016_separate_platform_admin_accounts.sql
update auth.users u
set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || '{"account_kind":"platform_admin"}'::jsonb
where exists (select 1 from public.platform_admins a where a.user_id = u.id);

create function public.is_dedicated_platform_account(target_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u
    where u.id = target_user and u.raw_app_meta_data ->> 'account_kind' = 'platform_admin'
  );
$$;

create function public.platform_account_access()
returns text language sql stable security definer set search_path = '' as $$
  select case
    when public.is_platform_admin() then 'admin'
    when public.is_dedicated_platform_account(auth.uid()) then 'admin_inactive'
    else 'merchant'
  end;
$$;

create function public.guard_platform_admin_grant()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_dedicated_platform_account(new.user_id)
    or exists (select 1 from public.store_members m where m.user_id = new.user_id)
    or exists (select 1 from public.stores s where s.created_by = new.user_id or s.billing_owner_id = new.user_id)
    or exists (select 1 from public.merchant_plan_payments p where p.user_id = new.user_id) then
    raise exception 'dedicated_admin_account_required';
  end if;
  return new;
end;
$$;

create function public.guard_merchant_account()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  target_user uuid;
begin
  if tg_table_name = 'stores' then
    if tg_op = 'INSERT' or new.created_by is distinct from old.created_by then
      target_user := new.created_by;
    end if;
    if tg_op = 'INSERT' or new.billing_owner_id is distinct from old.billing_owner_id then
      if public.is_dedicated_platform_account(new.billing_owner_id) then
        raise exception 'merchant_account_required';
      end if;
    end if;
  else
    if tg_op = 'INSERT' or new.user_id is distinct from old.user_id then
      target_user := new.user_id;
    end if;
  end if;
  if public.is_dedicated_platform_account(target_user) then
    raise exception 'merchant_account_required';
  end if;
  return new;
end;
$$;

create trigger platform_admin_account_only
  before insert or update of user_id on public.platform_admins
  for each row execute function public.guard_platform_admin_grant();
create trigger merchant_store_account_only
  before insert or update of created_by, billing_owner_id on public.stores
  for each row execute function public.guard_merchant_account();
create trigger merchant_member_account_only
  before insert or update of user_id on public.store_members
  for each row execute function public.guard_merchant_account();
create trigger merchant_payment_account_only
  before insert or update of user_id on public.merchant_plan_payments
  for each row execute function public.guard_merchant_account();

create or replace function public.has_store_role(
  requested_store_id uuid,
  allowed_roles public.store_member_role[] default array['owner', 'staff']::public.store_member_role[]
)
returns boolean language sql stable security definer set search_path = '' as $$
  select not public.is_dedicated_platform_account(auth.uid()) and exists (
    select 1 from public.store_members
    where store_id = requested_store_id and user_id = (select auth.uid()) and role = any (allowed_roles)
  );
$$;

revoke all on function public.is_dedicated_platform_account(uuid), public.platform_account_access(),
  public.guard_platform_admin_grant(), public.guard_merchant_account() from public, anon, authenticated;
grant execute on function public.platform_account_access() to authenticated;


-- Migration: 202611180001_store_banner_slideshow.sql
alter table public.stores
  add column banner_urls text[] not null default '{}',
  add constraint stores_banner_urls_valid check (
    cardinality(banner_urls) <= 3
    and coalesce(array_ndims(banner_urls), 1) = 1
    and coalesce(array_lower(banner_urls, 1), 1) = 1
    and array_position(banner_urls, null) is null
    and array_position(banner_urls, '') is null
  );

update public.stores set banner_urls = array[banner_url]
where banner_url is not null and banner_url <> '';

grant update (banner_urls) on public.stores to authenticated;

-- Keep the primary cover compatible with existing readers and older forms.
create function public.sync_store_banner_urls()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if cardinality(new.banner_urls) = 0 and new.banner_url is not null and new.banner_url <> '' then
      new.banner_urls := array[new.banner_url];
    end if;
  elsif new.banner_urls is not distinct from old.banner_urls
    and new.banner_url is distinct from old.banner_url then
    new.banner_urls := case when new.banner_url is null or new.banner_url = '' then '{}'::text[]
      else array[new.banner_url] || array_remove(array_remove(old.banner_urls, old.banner_url), new.banner_url)
    end;
  end if;
  new.banner_url := new.banner_urls[1];
  return new;
end;
$$;

create trigger sync_store_banner_urls before insert or update of banner_urls, banner_url on public.stores
  for each row execute function public.sync_store_banner_urls();
revoke all on function public.sync_store_banner_urls() from public, anon, authenticated;

create or replace function public.enforce_merchant_appearance_plan()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and new.billing_owner_id is distinct from old.billing_owner_id then
    raise exception 'billing_owner_is_read_only';
  end if;
  if current_user = 'authenticated'
    and row(new.logo_url, new.banner_url, new.banner_urls, new.theme_preset, new.storefront_layout,
      new.storefront_section_order, new.storefront_hidden_sections, new.storefront_style)
      is distinct from row(old.logo_url, old.banner_url, old.banner_urls, old.theme_preset, old.storefront_layout,
      old.storefront_section_order, old.storefront_hidden_sections, old.storefront_style)
    and not public.has_merchant_premium(old.id) then
    raise exception 'premium_plan_required';
  end if;
  return new;
end;
$$;


-- Migration: 202611180002_admin_overview_metrics.sql
-- Aggregate platform data on the server; never expose auth.users to the browser.
create function public.get_admin_overview_metrics()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
begin
  if public.is_platform_admin() is not true then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  with valid_payments as (
    select * from public.merchant_plan_payments
    where status = 'approved' and paid_at <= now()
      and (upgrade_expires_at is null or paid_at < upgrade_expires_at)
  ), active_plans as (
    select distinct on (user_id) user_id, plan
    from valid_payments where valid_until > now()
    order by user_id, valid_until desc, plan desc
  )
  select jsonb_build_object(
    'total_users', (select count(*) from auth.users),
    'total_revenue', coalesce((select sum(coalesce(upgrade_amount_vnd, amount_vnd)) from valid_payments), 0),
    'month_revenue', coalesce((select sum(coalesce(upgrade_amount_vnd, amount_vnd)) from valid_payments
      where paid_at >= (date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh')), 0),
    'new_stores', (select count(*) from public.stores where created_at >= (date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh')),
    'basic_count', (select count(*) from active_plans where plan = 'basic'),
    'plus_count', (select count(*) from active_plans where plan = 'plus')
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_admin_overview_metrics() from public, anon, authenticated;
grant execute on function public.get_admin_overview_metrics() to authenticated;


-- Migration: 202611180003_admin_store_revenue.sql
create function public.get_admin_store_sales_revenue(requested_store_id uuid)
returns bigint language plpgsql stable security invoker set search_path = '' as $$
declare result bigint;
begin
  if public.is_platform_admin() is not true then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select coalesce(sum(total_vnd), 0)::bigint into result from public.orders
  where store_id = requested_store_id and payment_status = 'paid'
    and status not in ('cancelled', 'rejected');
  return result;
end;
$$;
revoke all on function public.get_admin_store_sales_revenue(uuid) from public, anon, authenticated;
grant execute on function public.get_admin_store_sales_revenue(uuid) to authenticated;


-- Migration: 202611180004_admin_store_management.sql
create table public.admin_store_deletions (
  id bigint generated always as identity primary key,
  store_id uuid not null,
  store_name text not null,
  actor_id uuid not null references auth.users(id),
  deleted_at timestamptz not null default now()
);
alter table public.admin_store_deletions enable row level security;
revoke all on public.admin_store_deletions from public, anon, authenticated;
grant select on public.admin_store_deletions to authenticated;
create policy admin_store_deletions_admin_read on public.admin_store_deletions for select to authenticated using ((select public.is_platform_admin()));

create function public.admin_delete_empty_store(requested_store_id uuid, confirmation_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.stores%rowtype;
begin
  if public.is_platform_admin() is not true then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into target from public.stores where id = requested_store_id for update;
  if not found then raise exception 'store not found' using errcode = 'P0002'; end if;
  if confirmation_name is distinct from target.name then raise exception 'confirmation mismatch' using errcode = '22023'; end if;
  if exists (select 1 from public.orders where store_id = target.id) or exists (select 1 from public.reviews where store_id = target.id) then
    raise exception 'store has orders or reviews' using errcode = '23503';
  end if;
  insert into public.admin_store_deletions(store_id, store_name, actor_id) values (target.id, target.name, auth.uid());
  delete from public.stores where id = target.id;
end;
$$;
revoke all on function public.admin_delete_empty_store(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_delete_empty_store(uuid, text) to authenticated;


-- Migration: 202611180005_service_plan_drafts.sql
-- Drafts are intentionally separate from live billing until pricing, snapshots,
-- entitlements and quota enforcement are migrated together.
create table public.service_plan_drafts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 100),
  description text not null default '' check (char_length(description) <= 1000),
  price_vnd integer not null check (price_vnd >= 0),
  billing_months integer not null check (billing_months between 1 and 36),
  trial_days integer not null default 0 check (trial_days between 0 and 365),
  product_limit integer check (product_limit between 0 and 10000000),
  order_limit integer check (order_limit between 0 and 10000000),
  staff_limit integer check (staff_limit between 0 and 10000000),
  storage_mb integer check (storage_mb between 0 and 10000000),
  website_limit integer check (website_limit between 0 and 10000000),
  features jsonb not null default '{}'::jsonb check (jsonb_typeof(features) = 'object'),
  status text not null default 'draft' check (status in ('draft', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.service_plan_drafts enable row level security;
revoke all on public.service_plan_drafts from public, anon, authenticated;
grant select, insert, update, delete on public.service_plan_drafts to authenticated;
create policy service_plan_drafts_admin on public.service_plan_drafts for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));


-- Migration: 202611180006_service_invoices.sql
-- Internal service documents only; this is not a tax e-invoice.
create table public.service_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number bigint generated always as identity unique,
  payment_id uuid not null unique references public.merchant_plan_payments(id) on delete restrict,
  customer_id uuid not null references auth.users(id) on delete restrict,
  customer_name text not null,
  plan_name text not null,
  amount_vnd integer not null check (amount_vnd >= 0),
  issued_at timestamptz not null default now(),
  issued_by uuid not null references auth.users(id),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id),
  cancellation_reason text,
  check ((cancelled_at is null and cancelled_by is null and cancellation_reason is null) or
    (cancelled_at is not null and cancelled_by is not null and char_length(trim(cancellation_reason)) between 5 and 500))
);
alter table public.service_invoices enable row level security;
revoke all on public.service_invoices from public, anon, authenticated;
grant select on public.service_invoices to authenticated;
create policy service_invoices_admin_read on public.service_invoices for select to authenticated using ((select public.is_platform_admin()));

create function public.admin_create_service_invoice(requested_payment uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare p public.merchant_plan_payments%rowtype; result uuid; customer text;
begin
  if public.is_platform_admin() is not true then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into p from public.merchant_plan_payments where id = requested_payment for update;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
  if p.status not in ('pending', 'approved') or (p.upgrade_expires_at is not null and p.paid_at is not null and p.paid_at >= p.upgrade_expires_at) then
    raise exception 'payment requires reconciliation' using errcode = '22023';
  end if;
  select coalesce(nullif(trim(display_name), ''), 'Tài khoản ' || p.user_id::text) into customer from public.profiles where id = p.user_id;
  customer := coalesce(customer, 'Tài khoản ' || p.user_id::text);
  insert into public.service_invoices(payment_id, customer_id, customer_name, plan_name, amount_vnd, issued_by)
  values (p.id, p.user_id, customer, case p.plan when 'basic' then 'Gói Cơ bản' when 'plus' then 'Gói Nâng cao' else p.plan end, coalesce(p.upgrade_amount_vnd, p.amount_vnd), auth.uid())
  on conflict (payment_id) do nothing returning id into result;
  if result is null then select id into result from public.service_invoices where payment_id = p.id; end if;
  return result;
end;
$$;

create function public.admin_cancel_service_invoice(requested_invoice uuid, reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare inv public.service_invoices%rowtype; p public.merchant_plan_payments%rowtype;
begin
  if public.is_platform_admin() is not true then raise exception 'not authorized' using errcode = '42501'; end if;
  if char_length(trim(coalesce(reason, ''))) not between 5 and 500 then raise exception 'invalid reason' using errcode = '22023'; end if;
  select * into inv from public.service_invoices where id = requested_invoice for update;
  if not found or inv.cancelled_at is not null then raise exception 'invoice unavailable' using errcode = 'P0002'; end if;
  select * into p from public.merchant_plan_payments where id = inv.payment_id for update;
  if p.status <> 'pending' then raise exception 'only unpaid pending invoices can be cancelled' using errcode = '22023'; end if;
  update public.service_invoices set cancelled_at = now(), cancelled_by = auth.uid(), cancellation_reason = trim(reason) where id = inv.id;
end;
$$;
revoke all on function public.admin_create_service_invoice(uuid), public.admin_cancel_service_invoice(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_create_service_invoice(uuid), public.admin_cancel_service_invoice(uuid, text) to authenticated;

create view public.admin_service_invoice_view with (security_invoker = true) as
select i.*, p.transfer_code, p.paid_at, p.status as payment_status,
  case when i.cancelled_at is not null then 'cancelled'
    when p.status = 'approved' and (p.upgrade_expires_at is null or p.paid_at < p.upgrade_expires_at) then 'paid'
    when p.status = 'pending' then 'unpaid'
    else 'review' end as invoice_status
from public.service_invoices i join public.merchant_plan_payments p on p.id = i.payment_id;
grant select on public.admin_service_invoice_view to authenticated;


-- Migration: 202611180007_storefront_template_catalog.sql
-- Catalog metadata does not change existing storefront access or styles.
create table public.storefront_template_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 100),
  description text not null default '' check (char_length(description) <= 1000),
  category text not null default '' check (char_length(category) <= 80),
  base_style text not null check (base_style in ('original', 'modern', 'cozy', 'minimal')),
  required_plan text not null default 'plus' check (required_plan in ('basic', 'plus')),
  preview_url text check (preview_url is null or (char_length(preview_url) <= 2048 and preview_url ~ '^https://')),
  is_enabled boolean not null default false,
  is_featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.storefront_template_catalog enable row level security;
revoke all on public.storefront_template_catalog from public, anon, authenticated;
grant select, insert, update, delete on public.storefront_template_catalog to authenticated;
create policy storefront_template_catalog_admin on public.storefront_template_catalog for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
insert into public.storefront_template_catalog (name, description, category, base_style, required_plan, is_enabled)
values ('Giao diện hiện tại', 'Banner ngang và thẻ món bo góc.', 'Cơ bản', 'original', 'plus', true),
  ('Hiện đại', 'Ảnh bìa bo góc, tiêu đề đậm và thẻ món nổi bật.', 'Hiện đại', 'modern', 'plus', true),
  ('Ấm cúng', 'Kiểu chữ có chân, nền ấm và thẻ bo mềm.', 'Ấm cúng', 'cozy', 'plus', true),
  ('Tối giản', 'Đường nét gọn, nền trắng và viền mảnh.', 'Tối giản', 'minimal', 'plus', true);


-- Migration: 202611180008_business_categories.sql
-- Platform-wide business categories, independent of each store's menu categories.
create table public.business_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 100),
  slug text not null unique check (char_length(slug) <= 100 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text not null default '' check (char_length(description) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index business_categories_name_unique on public.business_categories (lower(trim(name)));
alter table public.business_categories enable row level security;
revoke all on public.business_categories from public, anon, authenticated;
grant select, insert, update, delete on public.business_categories to authenticated;
create policy business_categories_admin_only on public.business_categories for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));


-- Migration: 202611180009_support_tickets.sql
create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  created_by uuid not null references auth.users(id),
  subject text not null check (char_length(trim(subject)) between 3 and 160),
  category text not null check (category in ('account','billing','website','orders','other')),
  status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  assigned_to uuid references auth.users(id),
  rating smallint check (rating between 1 and 5),
  rating_note text check (char_length(rating_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  first_response_at timestamptz,
  resolved_at timestamptz
);
create index support_tickets_store_created_idx on public.support_tickets(store_id, created_at desc);
create index support_tickets_status_created_idx on public.support_tickets(status, created_at desc);
create table public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  author_role text not null check (author_role in ('admin','merchant')),
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index support_ticket_messages_ticket_idx on public.support_ticket_messages(ticket_id, created_at, id);
alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;
revoke all on public.support_tickets, public.support_ticket_messages from public, anon, authenticated;
grant select on public.support_tickets, public.support_ticket_messages to authenticated;
create policy support_tickets_read on public.support_tickets for select to authenticated using ((select public.is_platform_admin()) or (select public.has_store_role(store_id)));
create policy support_messages_read on public.support_ticket_messages for select to authenticated using (exists (select 1 from public.support_tickets t where t.id = ticket_id and ((select public.is_platform_admin()) or public.has_store_role(t.store_id))));

create function public.create_support_ticket(target_store uuid, title text, kind text, message text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare tid uuid; actor uuid := auth.uid(); role_name text;
begin
  if actor is null or not (public.is_platform_admin() or public.has_store_role(target_store)) then raise exception 'not authorized' using errcode = '42501'; end if;
  if char_length(trim(coalesce(title, ''))) not between 3 and 160 or char_length(trim(coalesce(message, ''))) not between 1 and 4000 or kind not in ('account','billing','website','orders','other') then raise exception 'invalid ticket' using errcode = '22023'; end if;
  role_name := case when public.is_platform_admin() then 'admin' else 'merchant' end;
  insert into public.support_tickets(store_id, created_by, subject, category) values (target_store, actor, trim(title), kind) returning id into tid;
  insert into public.support_ticket_messages(ticket_id, author_id, author_role, body) values (tid, actor, role_name, trim(message));
  return tid;
end; $$;

create function public.reply_support_ticket(target_ticket uuid, message text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.support_tickets%rowtype; role_name text;
begin
  select * into t from public.support_tickets where id = target_ticket for update;
  if not found or auth.uid() is null or not (public.is_platform_admin() or public.has_store_role(t.store_id)) then raise exception 'not authorized' using errcode = '42501'; end if;
  if t.status in ('resolved','closed') or char_length(trim(coalesce(message, ''))) not between 1 and 4000 then raise exception 'invalid message or closed ticket' using errcode = '22023'; end if;
  role_name := case when public.is_platform_admin() then 'admin' else 'merchant' end;
  insert into public.support_ticket_messages(ticket_id, author_id, author_role, body) values (t.id, auth.uid(), role_name, trim(message));
  update public.support_tickets set updated_at = now(), first_response_at = case when role_name = 'admin' then coalesce(first_response_at, now()) else first_response_at end where id = t.id;
end; $$;

create function public.admin_update_support_ticket(target_ticket uuid, next_status text, next_category text, assignee uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.is_platform_admin() is not true then raise exception 'not authorized' using errcode = '42501'; end if;
  if next_status not in ('open','in_progress','resolved','closed') or next_category not in ('account','billing','website','orders','other') or (assignee is not null and not exists(select 1 from public.platform_admins where user_id = assignee)) then raise exception 'invalid ticket update' using errcode = '22023'; end if;
  update public.support_tickets set status = next_status, category = next_category, assigned_to = assignee, updated_at = now(),
    resolved_at = case when next_status in ('resolved','closed') then coalesce(resolved_at, now()) else null end,
    rating = case when next_status in ('open','in_progress') then null else rating end,
    rating_note = case when next_status in ('open','in_progress') then null else rating_note end
  where id = target_ticket;
  if not found then raise exception 'ticket not found' using errcode = 'P0002'; end if;
end; $$;

create function public.rate_support_ticket(target_ticket uuid, stars integer, note text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.support_tickets%rowtype;
begin
  select * into t from public.support_tickets where id = target_ticket for update;
  if not found or auth.uid() is null or not public.has_store_role(t.store_id, array['owner']::public.store_member_role[]) then raise exception 'not authorized' using errcode = '42501'; end if;
  if t.status not in ('resolved','closed') or stars is null or stars not between 1 and 5 or char_length(coalesce(note,'')) > 500 then raise exception 'invalid rating' using errcode = '22023'; end if;
  update public.support_tickets set rating = stars, rating_note = nullif(trim(note), ''), updated_at = now() where id = t.id;
end; $$;
revoke all on function public.create_support_ticket(uuid,text,text,text), public.reply_support_ticket(uuid,text), public.admin_update_support_ticket(uuid,text,text,uuid), public.rate_support_ticket(uuid,integer,text) from public, anon, authenticated;
grant execute on function public.create_support_ticket(uuid,text,text,text), public.reply_support_ticket(uuid,text), public.admin_update_support_ticket(uuid,text,text,uuid), public.rate_support_ticket(uuid,integer,text) to authenticated;

create table public.support_ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id),
  object_path text not null unique,
  original_name text not null check (char_length(original_name) between 1 and 150),
  created_at timestamptz not null default now()
);
alter table public.support_ticket_attachments enable row level security;
revoke all on public.support_ticket_attachments from public, anon, authenticated;
grant select on public.support_ticket_attachments to authenticated;
create policy support_attachments_read on public.support_ticket_attachments for select to authenticated using (exists (select 1 from public.support_tickets t where t.id = ticket_id and (public.is_platform_admin() or public.has_store_role(t.store_id))));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-ticket-files', 'support-ticket-files', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf','text/plain'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy support_ticket_files_read on storage.objects for select to authenticated using (
  bucket_id = 'support-ticket-files' and exists (select 1 from public.support_tickets t where t.id::text = (storage.foldername(name))[1] and (public.is_platform_admin() or public.has_store_role(t.store_id)))
);
create policy support_ticket_files_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'support-ticket-files' and exists (select 1 from public.support_tickets t where t.id::text = (storage.foldername(name))[1] and t.status in ('open','in_progress') and (public.is_platform_admin() or public.has_store_role(t.store_id)))
);
create policy support_ticket_files_delete_own on storage.objects for delete to authenticated using (bucket_id = 'support-ticket-files' and owner_id = auth.uid()::text and not exists (select 1 from public.support_ticket_attachments a where a.object_path = name));

create function public.add_support_ticket_attachment(target_ticket uuid, path text, filename text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.support_tickets%rowtype;
begin
  select * into t from public.support_tickets where id = target_ticket for update;
  if not found or auth.uid() is null or not (public.is_platform_admin() or public.has_store_role(t.store_id)) then raise exception 'not authorized' using errcode = '42501'; end if;
  if t.status not in ('open','in_progress') or char_length(trim(coalesce(filename,''))) not between 1 and 150 or path !~ ('^' || t.id::text || '/[a-f0-9-]{36}$') or not exists (select 1 from storage.objects o where o.bucket_id = 'support-ticket-files' and o.name = path and o.owner_id = auth.uid()::text) then raise exception 'invalid attachment' using errcode = '22023'; end if;
  insert into public.support_ticket_attachments(ticket_id, uploaded_by, object_path, original_name) values (t.id, auth.uid(), path, trim(filename));
  update public.support_tickets set updated_at = now() where id = t.id;
end; $$;
revoke all on function public.add_support_ticket_attachment(uuid,text,text) from public, anon, authenticated;
grant execute on function public.add_support_ticket_attachment(uuid,text,text) to authenticated;


-- Migration: 202611180010_live_chat_management.sql
create table public.store_chat_assignments (
  store_id uuid primary key references public.stores(id) on delete cascade,
  assigned_to uuid references auth.users(id) on delete set null,
  assigned_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table public.store_chat_assignment_history (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  assigned_to uuid references auth.users(id) on delete set null,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.store_chat_assignments enable row level security;
alter table public.store_chat_assignment_history enable row level security;
revoke all on public.store_chat_assignments, public.store_chat_assignment_history from public, anon, authenticated;
grant select on public.store_chat_assignments, public.store_chat_assignment_history to authenticated;
create policy chat_assignments_admin_read on public.store_chat_assignments for select to authenticated using ((select public.is_platform_admin()));
create policy chat_assignment_history_admin_read on public.store_chat_assignment_history for select to authenticated using ((select public.is_platform_admin()));

create function public.assign_store_chat(target_store uuid, assignee uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.is_platform_admin() is not true then raise exception 'not authorized' using errcode = '42501'; end if;
  if not exists(select 1 from public.stores where id = target_store) or (assignee is not null and not exists(select 1 from public.platform_admins where user_id = assignee)) then raise exception 'invalid assignment' using errcode = '22023'; end if;
  insert into public.store_chat_assignments(store_id, assigned_to, assigned_by) values(target_store, assignee, auth.uid())
    on conflict(store_id) do update set assigned_to = excluded.assigned_to, assigned_by = excluded.assigned_by, updated_at = now();
  insert into public.store_chat_assignment_history(store_id, assigned_to, assigned_by) values(target_store, assignee, auth.uid());
end; $$;
revoke all on function public.assign_store_chat(uuid, uuid) from public, anon, authenticated;
grant execute on function public.assign_store_chat(uuid, uuid) to authenticated;

alter table public.store_admin_messages add column attachment_path text unique, add column attachment_name text;
alter table public.store_admin_messages add constraint chat_attachment_pair_check check ((attachment_path is null and attachment_name is null) or (attachment_path is not null and char_length(attachment_name) between 1 and 150));
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('store-chat-files', 'store-chat-files', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf','text/plain'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy store_chat_files_read on storage.objects for select to authenticated using (bucket_id = 'store-chat-files' and exists(select 1 from public.stores s where s.id::text = (storage.foldername(name))[1] and (public.is_platform_admin() or public.has_store_role(s.id))));
create policy store_chat_files_insert on storage.objects for insert to authenticated with check (bucket_id = 'store-chat-files' and exists(select 1 from public.stores s where s.id::text = (storage.foldername(name))[1] and (public.is_platform_admin() or public.has_store_role(s.id))));
create policy store_chat_files_delete_own on storage.objects for delete to authenticated using (bucket_id = 'store-chat-files' and owner_id = auth.uid()::text and not exists(select 1 from public.store_admin_messages m where m.attachment_path = name));

create function public.send_store_chat_attachment(target_store uuid, path text, filename text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.store_admin_messages%rowtype; actor uuid := auth.uid(); role_name text;
begin
  if actor is null or not (public.is_platform_admin() or public.has_store_role(target_store)) then raise exception 'not authorized' using errcode = '42501'; end if;
  if char_length(trim(coalesce(filename,''))) not between 1 and 150 or path !~ ('^' || target_store::text || '/[a-f0-9-]{36}$') or not exists (select 1 from storage.objects o where o.bucket_id = 'store-chat-files' and o.name = path and o.owner_id = actor::text) then raise exception 'invalid attachment' using errcode = '22023'; end if;
  role_name := case when public.is_platform_admin() then 'admin' else 'merchant' end;
  insert into public.store_admin_messages(store_id, sender_id, sender_role, body, attachment_path, attachment_name)
  values(target_store, actor, role_name, 'Tệp đính kèm: ' || trim(filename), path, trim(filename)) returning * into m;
  return to_jsonb(m);
end; $$;
revoke all on function public.send_store_chat_attachment(uuid,text,text) from public, anon, authenticated;
grant execute on function public.send_store_chat_attachment(uuid,text,text) to authenticated;

create table public.store_chat_presence (
  store_id uuid primary key references public.stores(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);
alter table public.store_chat_presence enable row level security;
revoke all on public.store_chat_presence from public, anon, authenticated;
grant select on public.store_chat_presence to authenticated;
create policy chat_presence_admin_read on public.store_chat_presence for select to authenticated using ((select public.is_platform_admin()));
create function public.heartbeat_store_chat(target_store uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_store_role(target_store) then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.store_chat_presence(store_id, last_seen_at) values(target_store, now())
  on conflict(store_id) do update set last_seen_at = excluded.last_seen_at;
end; $$;
revoke all on function public.heartbeat_store_chat(uuid) from public, anon, authenticated;
grant execute on function public.heartbeat_store_chat(uuid) to authenticated;


-- Migration: 202611180011_platform_notifications.sql
create table public.platform_notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 3 and 160),
  body text not null check (char_length(trim(body)) between 1 and 4000),
  category text not null check (category in ('general', 'maintenance', 'feature', 'payment', 'expiry')),
  audience text not null check (audience in ('all', 'store', 'plan')),
  target_store_id uuid references public.stores(id) on delete set null,
  target_plan text check (target_plan in ('basic', 'plus')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table public.platform_notification_recipients (
  notification_id uuid not null references public.platform_notifications(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  primary key (notification_id, store_id)
);
create index platform_notification_recipients_store_idx on public.platform_notification_recipients(store_id, notification_id);
create table public.platform_notification_reads (
  notification_id uuid not null,
  store_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, store_id, user_id),
  foreign key (notification_id, store_id) references public.platform_notification_recipients(notification_id, store_id) on delete cascade
);
alter table public.platform_notifications enable row level security;
alter table public.platform_notification_recipients enable row level security;
alter table public.platform_notification_reads enable row level security;
revoke all on public.platform_notifications, public.platform_notification_recipients, public.platform_notification_reads from public, anon, authenticated;
grant select on public.platform_notifications, public.platform_notification_recipients, public.platform_notification_reads to authenticated;
create policy platform_notification_recipients_read on public.platform_notification_recipients for select to authenticated using ((select public.is_platform_admin()) or (select public.has_store_role(store_id)));
create policy platform_notifications_read on public.platform_notifications for select to authenticated using ((select public.is_platform_admin()) or exists (select 1 from public.platform_notification_recipients r where r.notification_id = id and public.has_store_role(r.store_id)));
create policy platform_notification_reads_read on public.platform_notification_reads for select to authenticated using (user_id = (select auth.uid()) and (select public.has_store_role(store_id)));

create function public.admin_send_platform_notification(notice_title text, notice_body text, notice_category text, audience_kind text, store_target uuid, plan_target text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid; recipient_count integer;
begin
  if public.is_platform_admin() is not true then raise exception 'not authorized' using errcode = '42501'; end if;
  if char_length(trim(coalesce(notice_title,''))) not between 3 and 160 or char_length(trim(coalesce(notice_body,''))) not between 1 and 4000 or notice_category not in ('general','maintenance','feature','payment','expiry') or audience_kind not in ('all','store','plan') or (audience_kind = 'store' and store_target is null) or (audience_kind = 'plan' and coalesce(plan_target,'') not in ('basic','plus')) then raise exception 'invalid notification' using errcode = '22023'; end if;
  insert into public.platform_notifications(title, body, category, audience, target_store_id, target_plan, created_by)
    values(trim(notice_title), trim(notice_body), notice_category, audience_kind, case when audience_kind = 'store' then store_target end, case when audience_kind = 'plan' then plan_target end, auth.uid()) returning id into result;
  insert into public.platform_notification_recipients(notification_id, store_id)
    select result, s.id from public.stores s
    where audience_kind = 'all' or (audience_kind = 'store' and s.id = store_target) or (audience_kind = 'plan' and s.billing_owner_id is not null and (
      select p.plan from public.merchant_plan_payments p where p.user_id = s.billing_owner_id and p.status = 'approved' and p.valid_until > now()
      order by p.valid_until desc, p.plan desc limit 1
    ) = plan_target);
  get diagnostics recipient_count = row_count;
  if recipient_count = 0 then raise exception 'no matching stores' using errcode = 'P0002'; end if;
  return result;
end; $$;

create function public.mark_platform_notification_read(requested_notice uuid, requested_store uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_store_role(requested_store) or not exists(select 1 from public.platform_notification_recipients where notification_id = requested_notice and store_id = requested_store) then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.platform_notification_reads(notification_id, store_id, user_id) values(requested_notice, requested_store, auth.uid()) on conflict do nothing;
end; $$;

create function public.count_unread_platform_notifications(requested_store uuid)
returns bigint language sql stable security invoker set search_path = '' as $$
  select count(*) from public.platform_notification_recipients r
  where r.store_id = requested_store and public.has_store_role(requested_store)
    and not exists (select 1 from public.platform_notification_reads x where x.notification_id = r.notification_id and x.store_id = r.store_id and x.user_id = auth.uid());
$$;
revoke all on function public.admin_send_platform_notification(text,text,text,text,uuid,text), public.mark_platform_notification_read(uuid,uuid), public.count_unread_platform_notifications(uuid) from public, anon, authenticated;
grant execute on function public.admin_send_platform_notification(text,text,text,text,uuid,text), public.mark_platform_notification_read(uuid,uuid), public.count_unread_platform_notifications(uuid) to authenticated;


-- Migration: 202611180012_backup_records.sql
-- Manual records only: inserting a row does not run or verify a backup/restore.
create table public.backup_records (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('database', 'images', 'store_files', 'other')),
  result text not null check (result in ('success', 'failed')),
  integrity_result text not null check (integrity_result in ('not_checked', 'passed', 'failed')),
  completed_at timestamptz not null,
  reference text not null check (char_length(trim(reference)) between 1 and 160),
  notes text not null default '' check (char_length(notes) <= 1000),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  check (result <> 'failed' or integrity_result <> 'passed')
);
create index backup_records_recorded_idx on public.backup_records(recorded_at desc, id);
create table public.backup_restore_records (
  id uuid primary key default gen_random_uuid(),
  backup_id uuid not null references public.backup_records(id) on delete restrict,
  target text not null check (target in ('test', 'production', 'other')),
  result text not null check (result in ('success', 'failed')),
  completed_at timestamptz not null,
  notes text not null default '' check (char_length(notes) <= 1000),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now()
);
create index backup_restore_records_recorded_idx on public.backup_restore_records(recorded_at desc, id);
alter table public.backup_records enable row level security;
alter table public.backup_restore_records enable row level security;
revoke all on public.backup_records, public.backup_restore_records from public, anon, authenticated;
grant select, insert on public.backup_records, public.backup_restore_records to authenticated;
create policy backup_records_admin_read on public.backup_records for select to authenticated using ((select public.is_platform_admin()));
create policy backup_records_admin_insert on public.backup_records for insert to authenticated with check ((select public.is_platform_admin()) and recorded_by = (select auth.uid()));
create policy backup_restore_records_admin_read on public.backup_restore_records for select to authenticated using ((select public.is_platform_admin()));
create policy backup_restore_records_admin_insert on public.backup_restore_records for insert to authenticated with check ((select public.is_platform_admin()) and recorded_by = (select auth.uid()) and exists (select 1 from public.backup_records b where b.id = backup_id and b.result = 'success'));


-- Migration: 202611180013_admin_store_security_audit.sql
-- Initial, intentionally narrow audit trail: selected admin changes to stores.
-- Events performed without an authenticated admin JWT cannot be attributed here.
create table public.admin_store_security_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  store_id uuid not null,
  store_name text not null,
  action text not null check (action in ('updated', 'deleted')),
  changed_fields text[] not null default '{}',
  old_status text,
  new_status text,
  occurred_at timestamptz not null default now()
);
create index admin_store_security_audit_time_idx on public.admin_store_security_audit(occurred_at desc, id);
alter table public.admin_store_security_audit enable row level security;
revoke all on public.admin_store_security_audit from public, anon, authenticated;
grant select on public.admin_store_security_audit to authenticated;
create policy admin_store_security_audit_read on public.admin_store_security_audit for select to authenticated using ((select public.is_platform_admin()));

create function public.audit_admin_store_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare fields text[] := '{}';
begin
  if auth.uid() is null or public.is_platform_admin() is not true then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'DELETE' then
    insert into public.admin_store_security_audit(actor_id, store_id, store_name, action, old_status)
      values(auth.uid(), old.id, old.name, 'deleted', old.status::text);
    return old;
  end if;
  if old.name is distinct from new.name then fields := array_append(fields, 'name'); end if;
  if old.slug is distinct from new.slug then fields := array_append(fields, 'slug'); end if;
  if old.phone is distinct from new.phone then fields := array_append(fields, 'phone'); end if;
  if old.address is distinct from new.address then fields := array_append(fields, 'address'); end if;
  if old.description is distinct from new.description then fields := array_append(fields, 'description'); end if;
  if old.status is distinct from new.status then fields := array_append(fields, 'status'); end if;
  if cardinality(fields) > 0 then
    insert into public.admin_store_security_audit(actor_id, store_id, store_name, action, changed_fields, old_status, new_status)
      values(auth.uid(), new.id, new.name, 'updated', fields,
        case when old.status is distinct from new.status then old.status::text end,
        case when old.status is distinct from new.status then new.status::text end);
  end if;
  return new;
end; $$;
revoke all on function public.audit_admin_store_change() from public, anon, authenticated;
create trigger admin_store_security_audit_trigger after update or delete on public.stores
  for each row execute function public.audit_admin_store_change();


-- Migration: 202611180014_admin_business_report.sql
-- The report uses confirmed platform-plan payments, not store order revenue.
create function public.get_admin_business_report(report_month date)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  first_month date;
  next_month date;
  oldest_month date;
  current_month date := date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh')::date;
  output jsonb;
begin
  if public.is_platform_admin() is not true then raise exception 'not authorized' using errcode = '42501'; end if;
  if report_month is null then raise exception 'invalid month' using errcode = '22023'; end if;
  first_month := date_trunc('month', report_month)::date;
  if first_month < date '2010-01-01' or first_month > current_month then raise exception 'invalid month' using errcode = '22023'; end if;
  next_month := (first_month + interval '1 month')::date;
  oldest_month := (first_month - interval '11 months')::date;
  with valid_payments as (
    select p.* from public.merchant_plan_payments p
    where p.status = 'approved' and p.paid_at <= now()
      and (p.upgrade_expires_at is null or p.paid_at < p.upgrade_expires_at)
  ), current_plans as (
    select distinct on (user_id) user_id, plan
    from valid_payments where valid_until > now()
    order by user_id, valid_until desc, plan desc
  ), monthly as (
    select date_trunc('month', p.paid_at at time zone 'Asia/Ho_Chi_Minh')::date as month_start,
      sum(coalesce(p.upgrade_amount_vnd, p.amount_vnd))::bigint as revenue
    from valid_payments p
    where p.paid_at >= (oldest_month::timestamp at time zone 'Asia/Ho_Chi_Minh')
      and p.paid_at < (next_month::timestamp at time zone 'Asia/Ho_Chi_Minh')
    group by 1
  ), months as (
    select (oldest_month + (n * interval '1 month'))::date as month_start
    from pg_catalog.generate_series(0, 11) as n
  ), selected_payments as (
    select * from valid_payments
    where paid_at >= (first_month::timestamp at time zone 'Asia/Ho_Chi_Minh')
      and paid_at < (next_month::timestamp at time zone 'Asia/Ho_Chi_Minh')
  )
  select jsonb_build_object(
    'month', first_month,
    'new_stores', (select count(*) from public.stores where created_at >= (first_month::timestamp at time zone 'Asia/Ho_Chi_Minh') and created_at < (next_month::timestamp at time zone 'Asia/Ho_Chi_Minh')),
    'total_stores', (select count(*) from public.stores),
    'active_stores', (select count(*) from public.stores where status = 'active'),
    'revenue', coalesce((select sum(coalesce(upgrade_amount_vnd, amount_vnd)) from selected_payments), 0),
    'basic_revenue', coalesce((select sum(coalesce(upgrade_amount_vnd, amount_vnd)) from selected_payments where plan = 'basic'), 0),
    'plus_revenue', coalesce((select sum(coalesce(upgrade_amount_vnd, amount_vnd)) from selected_payments where plan = 'plus'), 0),
    'upgrade_count', (select count(*) from selected_payments where upgrade_amount_vnd is not null),
    'payment_count', (select count(*) from selected_payments),
    'active_basic', (select count(*) from current_plans where plan = 'basic'),
    'active_plus', (select count(*) from current_plans where plan = 'plus'),
    'monthly_revenue', (select jsonb_agg(jsonb_build_object('month', m.month_start, 'amount', coalesce(d.revenue, 0)) order by m.month_start) from months m left join monthly d on d.month_start = m.month_start)
  ) into output;
  return output;
end; $$;
revoke all on function public.get_admin_business_report(date) from public, anon, authenticated;
grant execute on function public.get_admin_business_report(date) to authenticated;


-- Migration: 202611180015_platform_role_catalog.sql
-- Catalog only. It does not grant roles or change existing admin permissions.
create table public.platform_role_catalog (
  code text primary key check (code ~ '^[a-z]+(_[a-z]+)*$'),
  name text not null,
  display_name text not null,
  responsibilities text not null,
  sort_order integer not null
);
alter table public.platform_role_catalog enable row level security;
revoke all on public.platform_role_catalog from public, anon, authenticated;
grant select on public.platform_role_catalog to authenticated;
create policy platform_role_catalog_admin_read on public.platform_role_catalog for select to authenticated using ((select public.is_platform_admin()));
insert into public.platform_role_catalog(code, name, display_name, responsibilities, sort_order) values
  ('super_admin', 'Super Admin', 'Quản trị viên cấp cao', 'Toàn quyền quản trị KingWeb', 1),
  ('system_admin', 'System Admin', 'Quản trị hệ thống', 'Quản lý vận hành và cấu hình hệ thống', 2),
  ('support_admin', 'Support Admin', 'Nhân viên hỗ trợ', 'Tiếp nhận và xử lý yêu cầu hỗ trợ', 3),
  ('finance_admin', 'Finance Admin', 'Nhân viên tài chính', 'Quản lý giao dịch, thanh toán, hoàn tiền', 4),
  ('sales_admin', 'Sales Admin', 'Nhân viên kinh doanh', 'Quản lý khách hàng và gói dịch vụ', 5),
  ('technical_admin', 'Technical Admin', 'Nhân viên kỹ thuật', 'Theo dõi lỗi, máy chủ và tích hợp', 6),
  ('content_admin', 'Content Admin', 'Nhân viên nội dung', 'Quản lý nội dung và thông báo', 7);


-- Migration: 202611180016_support_role_permissions.sql
-- First scoped role: support tickets only. Existing platform_admins remain full admins.
create table public.platform_staff_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role_code text not null references public.platform_role_catalog(code),
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now()
);
create table public.platform_staff_role_audit (
  id uuid primary key default gen_random_uuid(),
  target_user uuid not null references auth.users(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  old_role text,
  new_role text,
  occurred_at timestamptz not null default now()
);
alter table public.platform_staff_roles enable row level security;
alter table public.platform_staff_role_audit enable row level security;
revoke all on public.platform_staff_roles, public.platform_staff_role_audit from public, anon, authenticated;
grant select on public.platform_staff_roles, public.platform_staff_role_audit to authenticated;
create policy staff_roles_admin_read on public.platform_staff_roles for select to authenticated using ((select public.is_platform_admin()));
create policy staff_roles_self_read on public.platform_staff_roles for select to authenticated using (user_id = (select auth.uid()));
create policy staff_role_audit_admin_read on public.platform_staff_role_audit for select to authenticated using ((select public.is_platform_admin()));

create function public.has_support_ticket_permission()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or exists (
    select 1 from public.platform_staff_roles r where r.user_id = auth.uid() and r.role_code = 'support_admin'
  );
$$;
create function public.assign_support_staff_role(target_user uuid, enable_role boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare previous text;
begin
  if public.is_platform_admin() is not true then raise exception 'not authorized' using errcode = '42501'; end if;
  if target_user is null or enable_role is null or not public.is_dedicated_platform_account(target_user) then raise exception 'invalid staff account' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_user::text, 4381));
  if exists (select 1 from public.platform_admins where user_id = target_user) then raise exception 'account has full admin access' using errcode = '22023'; end if;
  select role_code into previous from public.platform_staff_roles where user_id = target_user;
  if enable_role then
    insert into public.platform_staff_roles(user_id, role_code, granted_by) values(target_user, 'support_admin', auth.uid())
      on conflict(user_id) do update set role_code = excluded.role_code, granted_by = excluded.granted_by, granted_at = now();
  else
    delete from public.platform_staff_roles where user_id = target_user;
  end if;
  insert into public.platform_staff_role_audit(target_user, actor_id, old_role, new_role) values(target_user, auth.uid(), previous, case when enable_role then 'support_admin' end);
end; $$;

-- Never silently combine a scoped role with unrestricted admin access.
create function public.guard_full_admin_against_scoped_role()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 4381));
  if exists(select 1 from public.platform_staff_roles where user_id = new.user_id) then raise exception 'scoped_role_must_be_removed' using errcode = '22023'; end if;
  return new;
end; $$;
revoke all on function public.guard_full_admin_against_scoped_role() from public, anon, authenticated;
create trigger full_admin_guard_scoped_role before insert or update of user_id on public.platform_admins for each row execute function public.guard_full_admin_against_scoped_role();

-- Store options are exposed via a limited RPC; no broad stores-table grant.
create policy support_tickets_scoped_read on public.support_tickets for select to authenticated using ((select public.has_support_ticket_permission()));
create policy support_ticket_messages_scoped_read on public.support_ticket_messages for select to authenticated using ((select public.has_support_ticket_permission()));
create policy support_ticket_attachments_scoped_read on public.support_ticket_attachments for select to authenticated using ((select public.has_support_ticket_permission()));
create policy support_ticket_files_scoped_read on storage.objects for select to authenticated using (
  bucket_id = 'support-ticket-files' and (select public.has_support_ticket_permission()) and exists (select 1 from public.support_tickets t where t.id::text = (storage.foldername(name))[1])
);
create policy support_ticket_files_scoped_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'support-ticket-files' and (select public.has_support_ticket_permission()) and exists (select 1 from public.support_tickets t where t.id::text = (storage.foldername(name))[1] and t.status in ('open','in_progress'))
);

create or replace function public.create_support_ticket(target_store uuid, title text, kind text, message text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare tid uuid; actor uuid := auth.uid(); role_name text;
begin
  if actor is null or not (public.has_support_ticket_permission() or public.has_store_role(target_store)) then raise exception 'not authorized' using errcode = '42501'; end if;
  if char_length(trim(coalesce(title, ''))) not between 3 and 160 or char_length(trim(coalesce(message, ''))) not between 1 and 4000 or kind not in ('account','billing','website','orders','other') then raise exception 'invalid ticket' using errcode = '22023'; end if;
  role_name := case when public.has_support_ticket_permission() then 'admin' else 'merchant' end;
  insert into public.support_tickets(store_id, created_by, subject, category) values (target_store, actor, trim(title), kind) returning id into tid;
  insert into public.support_ticket_messages(ticket_id, author_id, author_role, body) values (tid, actor, role_name, trim(message));
  return tid;
end; $$;
create or replace function public.reply_support_ticket(target_ticket uuid, message text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.support_tickets%rowtype; role_name text;
begin
  select * into t from public.support_tickets where id = target_ticket for update;
  if not found or auth.uid() is null or not (public.has_support_ticket_permission() or public.has_store_role(t.store_id)) then raise exception 'not authorized' using errcode = '42501'; end if;
  if t.status in ('resolved','closed') or char_length(trim(coalesce(message, ''))) not between 1 and 4000 then raise exception 'invalid message or closed ticket' using errcode = '22023'; end if;
  role_name := case when public.has_support_ticket_permission() then 'admin' else 'merchant' end;
  insert into public.support_ticket_messages(ticket_id, author_id, author_role, body) values (t.id, auth.uid(), role_name, trim(message));
  update public.support_tickets set updated_at = now(), first_response_at = case when role_name = 'admin' then coalesce(first_response_at, now()) else first_response_at end where id = t.id;
end; $$;
create or replace function public.admin_update_support_ticket(target_ticket uuid, next_status text, next_category text, assignee uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.has_support_ticket_permission() is not true then raise exception 'not authorized' using errcode = '42501'; end if;
  if next_status not in ('open','in_progress','resolved','closed') or next_category not in ('account','billing','website','orders','other') or (assignee is not null and not exists(select 1 from public.platform_admins where user_id = assignee) and not exists(select 1 from public.platform_staff_roles where user_id = assignee and role_code = 'support_admin')) then raise exception 'invalid ticket update' using errcode = '22023'; end if;
  update public.support_tickets set status = next_status, category = next_category, assigned_to = assignee, updated_at = now(),
    resolved_at = case when next_status in ('resolved','closed') then coalesce(resolved_at, now()) else null end,
    rating = case when next_status in ('open','in_progress') then null else rating end,
    rating_note = case when next_status in ('open','in_progress') then null else rating_note end
  where id = target_ticket;
  if not found then raise exception 'ticket not found' using errcode = 'P0002'; end if;
end; $$;
create or replace function public.add_support_ticket_attachment(target_ticket uuid, path text, filename text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.support_tickets%rowtype;
begin
  select * into t from public.support_tickets where id = target_ticket for update;
  if not found or auth.uid() is null or not (public.has_support_ticket_permission() or public.has_store_role(t.store_id)) then raise exception 'not authorized' using errcode = '42501'; end if;
  if t.status not in ('open','in_progress') or char_length(trim(coalesce(filename,''))) not between 1 and 150 or path !~ ('^' || t.id::text || '/[a-f0-9-]{36}$') or not exists (select 1 from storage.objects o where o.bucket_id = 'support-ticket-files' and o.name = path and o.owner_id = auth.uid()::text) then raise exception 'invalid attachment' using errcode = '22023'; end if;
  insert into public.support_ticket_attachments(ticket_id, uploaded_by, object_path, original_name) values (t.id, auth.uid(), path, trim(filename));
  update public.support_tickets set updated_at = now() where id = t.id;
end; $$;

create function public.get_support_staff()
returns table(user_id uuid, display_name text) language sql stable security definer set search_path = '' as $$
  select a.user_id, coalesce(nullif(p.display_name, ''), 'Admin ' || left(a.user_id::text, 8)) from public.platform_admins a left join public.profiles p on p.id = a.user_id where public.has_support_ticket_permission()
  union
  select r.user_id, coalesce(nullif(p.display_name, ''), 'Hỗ trợ ' || left(r.user_id::text, 8)) from public.platform_staff_roles r left join public.profiles p on p.id = r.user_id where r.role_code = 'support_admin' and public.has_support_ticket_permission();
$$;
create function public.get_support_store_options()
returns table(id uuid, name text) language sql stable security definer set search_path = '' as $$
  select s.id, s.name from public.stores s where public.has_support_ticket_permission() order by s.name, s.id;
$$;
revoke all on function public.has_support_ticket_permission(), public.assign_support_staff_role(uuid,boolean), public.get_support_staff(), public.get_support_store_options() from public, anon, authenticated;
grant execute on function public.has_support_ticket_permission(), public.assign_support_staff_role(uuid,boolean), public.get_support_staff(), public.get_support_store_options() to authenticated;


-- Migration: 202611180017_merchant_overview.sql
-- Some installations have not applied the earlier inventory alert migration.
-- Keep this dependency safe to apply before or after that migration.
alter table public.products
  add column if not exists low_stock_threshold integer not null default 5
  check (low_stock_threshold >= 0);

-- Store overview aggregates use the caller's existing row-level permissions.
create or replace function public.get_merchant_overview(p_store_id uuid)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
with bounds as (
  select (now() at time zone 'Asia/Ho_Chi_Minh')::date as today
), permitted as (
  select p_store_id as id where public.has_store_role(p_store_id)
), store_orders as (
  select o.*, regexp_replace(o.customer_phone, '[^0-9]', '', 'g') as phone_key
  from public.orders o join permitted p on p.id = o.store_id
), customers as (
  select phone_key, min(created_at) as first_order, count(*) as order_count,
    max(customer_name) as customer_name
  from store_orders where phone_key <> '' group by phone_key
), product_totals as (
  select i.product_id, case when i.product_id is null then i.product_name_snapshot end as deleted_name,
    max(i.product_name_snapshot) as product_name, sum(i.quantity)::bigint as quantity,
    sum(i.quantity::bigint * i.unit_price_snapshot_vnd)::bigint as revenue
  from public.order_items i join store_orders o on o.id = i.order_id and o.store_id = i.store_id
  where o.payment_status = 'paid' and o.status not in ('cancelled', 'rejected')
  group by i.product_id, case when i.product_id is null then i.product_name_snapshot end
), daily_orders as (
  select d.day::date as day, count(o.id)::bigint as total
  from bounds b cross join lateral generate_series(b.today - 6, b.today, interval '1 day') d(day)
  left join store_orders o on (o.created_at at time zone 'Asia/Ho_Chi_Minh')::date = d.day::date
  group by d.day
)
select jsonb_build_object(
  'revenue_today', coalesce((select sum(o.total_vnd) from store_orders o, bounds b where o.payment_status = 'paid' and o.status not in ('cancelled','rejected') and (o.payment_confirmed_at at time zone 'Asia/Ho_Chi_Minh')::date = b.today), 0),
  'revenue_month', coalesce((select sum(o.total_vnd) from store_orders o, bounds b where o.payment_status = 'paid' and o.status not in ('cancelled','rejected') and o.payment_confirmed_at >= (date_trunc('month', b.today)::timestamp at time zone 'Asia/Ho_Chi_Minh') and o.payment_confirmed_at < ((b.today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')), 0),
  'revenue_year', coalesce((select sum(o.total_vnd) from store_orders o, bounds b where o.payment_status = 'paid' and o.status not in ('cancelled','rejected') and o.payment_confirmed_at >= (date_trunc('year', b.today)::timestamp at time zone 'Asia/Ho_Chi_Minh') and o.payment_confirmed_at < ((b.today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')), 0),
  'total_orders', (select count(*) from store_orders),
  'new_orders', (select count(*) from store_orders where status = 'pending'),
  'processing_orders', (select count(*) from store_orders where status in ('confirmed','preparing','ready','out_for_delivery')),
  'completed_orders', (select count(*) from store_orders where status = 'completed'),
  'cancelled_orders', (select count(*) from store_orders where status in ('cancelled','rejected')),
  'total_customers', (select count(*) from customers),
  'new_customers_month', (select count(*) from customers c, bounds b where c.first_order >= (date_trunc('month', b.today)::timestamp at time zone 'Asia/Ho_Chi_Minh') and c.first_order < ((b.today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')),
  'low_stock', (select count(*) from public.products p join permitted a on a.id = p.store_id where p.status = 'active' and p.stock_quantity <= p.low_stock_threshold),
  'daily_orders', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'total', total) order by day) from daily_orders), '[]'::jsonb),
  'top_revenue_products', coalesce((select jsonb_agg(to_jsonb(t)) from (select product_name, quantity, revenue from product_totals order by revenue desc, product_name limit 5) t), '[]'::jsonb),
  'top_customers', coalesce((select jsonb_agg(to_jsonb(t)) from (select customer_name, order_count from customers order by order_count desc, customer_name, phone_key limit 5) t), '[]'::jsonb)
) from permitted;
$$;
revoke all on function public.get_merchant_overview(uuid) from public, anon;
grant execute on function public.get_merchant_overview(uuid) to authenticated;


-- Migration: 202611180018_store_brands.sql
create table if not exists public.store_brands (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  description text not null default '' check (length(description) <= 2000),
  logo_url text,
  created_at timestamptz not null default now(),
  unique (id, store_id)
);
create unique index if not exists store_brands_store_name_unique on public.store_brands (store_id, lower(trim(name)));
alter table public.store_brands enable row level security;
grant select, insert, update, delete on public.store_brands to authenticated;
create policy store_brands_read on public.store_brands for select to authenticated using (public.has_store_role(store_id));
create policy store_brands_write on public.store_brands for all to authenticated
  using (public.has_store_role(store_id, array['owner']::public.store_member_role[]))
  with check (public.has_store_role(store_id, array['owner']::public.store_member_role[]));
alter table public.products add column if not exists brand_id uuid;
alter table public.products add constraint products_brand_store_fkey foreign key (brand_id, store_id) references public.store_brands(id, store_id) on delete restrict;
create index if not exists products_store_brand_idx on public.products(store_id, brand_id);


-- Migration: 202611180019_order_processing_history.sql
-- Only future changes can be recorded; past processing history cannot be reconstructed.
create table public.store_order_events (
  id bigint generated always as identity primary key,
  store_id uuid not null,
  order_id uuid not null,
  event_type text not null check (event_type in ('status', 'payment', 'cancellation', 'refund')),
  old_value text,
  new_value text,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (order_id, store_id) references public.orders(id, store_id) on delete cascade
);
create index store_order_events_order_time_idx on public.store_order_events(store_id, order_id, created_at, id);
alter table public.store_order_events enable row level security;
revoke all on public.store_order_events from public, anon, authenticated;
grant select on public.store_order_events to authenticated;
create policy store_order_events_read on public.store_order_events for select to authenticated using (public.has_store_role(store_id));

create function public.record_store_order_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status is distinct from new.status then
    insert into public.store_order_events(store_id, order_id, event_type, old_value, new_value, actor_id)
    values(new.store_id, new.id, 'status', old.status::text, new.status::text, auth.uid());
  end if;
  if old.payment_status is distinct from new.payment_status then
    insert into public.store_order_events(store_id, order_id, event_type, old_value, new_value, actor_id)
    values(new.store_id, new.id, 'payment', old.payment_status::text, new.payment_status::text, auth.uid());
  end if;
  if old.cancellation_request_status is distinct from new.cancellation_request_status then
    insert into public.store_order_events(store_id, order_id, event_type, old_value, new_value, actor_id)
    values(new.store_id, new.id, 'cancellation', old.cancellation_request_status::text, new.cancellation_request_status::text, auth.uid());
  end if;
  if (to_jsonb(old)->>'refunded_at') is distinct from (to_jsonb(new)->>'refunded_at') and (to_jsonb(new)->>'refunded_at') is not null then
    insert into public.store_order_events(store_id, order_id, event_type, new_value, actor_id)
    values(new.store_id, new.id, 'refund', to_jsonb(new)->>'refund_amount_vnd', auth.uid());
  end if;
  return new;
end;
$$;
revoke all on function public.record_store_order_event() from public, anon, authenticated;
create trigger record_store_order_event after update on public.orders for each row execute function public.record_store_order_event();


-- Migration: 202611180020_platform_general_settings.sql
create table public.platform_general_settings (
  id boolean primary key default true check (id),
  platform_name text not null default 'KingWeb' check (length(trim(platform_name)) between 1 and 100),
  description text not null default '' check (length(description) <= 1000),
  contact_email text not null default '' check (length(contact_email) <= 254),
  support_phone text not null default '' check (length(support_phone) <= 30),
  default_language text not null default 'vi' check (default_language = 'vi'),
  default_timezone text not null default 'Asia/Ho_Chi_Minh' check (default_timezone = 'Asia/Ho_Chi_Minh'),
  logo_url text,
  favicon_url text,
  updated_at timestamptz not null default now()
);
insert into public.platform_general_settings(id) values (true);
alter table public.platform_general_settings enable row level security;
grant select on public.platform_general_settings to anon, authenticated;
grant update on public.platform_general_settings to authenticated;
create policy platform_general_settings_read on public.platform_general_settings for select to anon, authenticated using (true);
create policy platform_general_settings_update on public.platform_general_settings for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('platform-assets', 'platform-assets', true, 2097152, array['image/png','image/jpeg','image/webp','image/x-icon','image/vnd.microsoft.icon'])
on conflict (id) do nothing;
create policy platform_assets_public_read on storage.objects for select to public using (bucket_id = 'platform-assets');
create policy platform_assets_admin_insert on storage.objects for insert to authenticated with check (bucket_id = 'platform-assets' and public.is_platform_admin());


-- Migration: 202611180021_platform_email_settings.sql
-- SMTP credentials are only accessed by trusted server code using the service role.
create table public.platform_email_settings (
  id boolean primary key default true check (id),
  smtp_host text not null check (length(smtp_host) between 1 and 253),
  smtp_port integer not null check (smtp_port in (465, 587, 2525)),
  smtp_username text not null check (length(smtp_username) between 1 and 254),
  password_ciphertext text not null,
  sender_email text not null check (length(sender_email) between 3 and 254),
  sender_name text not null check (length(sender_name) between 1 and 100),
  updated_at timestamptz not null default now()
);
alter table public.platform_email_settings enable row level security;
revoke all on public.platform_email_settings from public, anon, authenticated;
grant select, insert, update on public.platform_email_settings to service_role;


-- Migration: 202611180022_platform_payment_settings.sql
-- This switch only controls creation of new plan payments. Existing transfers
-- must continue to be accepted and reconciled by the authenticated webhook.
create table public.platform_payment_settings (
  id boolean primary key default true check (id),
  sepay_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.platform_payment_settings (id) values (true);
alter table public.platform_payment_settings enable row level security;
grant select on public.platform_payment_settings to anon, authenticated;
grant update on public.platform_payment_settings to authenticated;
create policy platform_payment_settings_read on public.platform_payment_settings for select to anon, authenticated using (true);
create policy platform_payment_settings_update on public.platform_payment_settings for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

create function public.enforce_plan_payment_enabled() returns trigger
language plpgsql security definer set search_path = '' as $$
declare enabled boolean;
begin
  select sepay_enabled into enabled from public.platform_payment_settings where id = true for share;
  if enabled is distinct from true then raise exception 'plan_payments_disabled' using errcode = 'P0001'; end if;
  return new;
end;
$$;
revoke all on function public.enforce_plan_payment_enabled() from public, anon, authenticated;
create trigger enforce_plan_payment_enabled before insert on public.merchant_plan_payments
for each row execute function public.enforce_plan_payment_enabled();


-- Migration: 202611180023_platform_security_settings.sql
create table public.platform_security_settings (
  id boolean primary key default true check (id),
  staff_password_min_length integer not null default 12 check (staff_password_min_length between 12 and 64),
  updated_at timestamptz not null default now()
);
insert into public.platform_security_settings(id) values (true);
alter table public.platform_security_settings enable row level security;
revoke all on public.platform_security_settings from public, anon, authenticated;
grant select, update on public.platform_security_settings to authenticated;
create policy platform_security_settings_read on public.platform_security_settings for select to authenticated using (public.is_platform_admin());
create policy platform_security_settings_update on public.platform_security_settings for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());


-- Migration: 202611180024_platform_notification_settings.sql
create table public.platform_notification_settings (
  id boolean primary key default true check (id),
  in_app_enabled boolean not null default true,
  maintenance_enabled boolean not null default true,
  payment_enabled boolean not null default true,
  maintenance_title text not null default 'Thông báo bảo trì' check (length(trim(maintenance_title)) between 3 and 160),
  maintenance_body text not null default 'Hệ thống sẽ được bảo trì. Vui lòng theo dõi thông báo để biết thời gian cụ thể.' check (length(trim(maintenance_body)) between 1 and 4000),
  payment_title text not null default 'Thông báo thanh toán' check (length(trim(payment_title)) between 3 and 160),
  payment_body text not null default 'Vui lòng kiểm tra thông tin thanh toán dịch vụ của cửa hàng.' check (length(trim(payment_body)) between 1 and 4000),
  updated_at timestamptz not null default now()
);
insert into public.platform_notification_settings(id) values (true);
alter table public.platform_notification_settings enable row level security;
revoke all on public.platform_notification_settings from public, anon, authenticated;
grant select, update on public.platform_notification_settings to authenticated;
create policy platform_notification_settings_read on public.platform_notification_settings for select to authenticated using (public.is_platform_admin());
create policy platform_notification_settings_update on public.platform_notification_settings for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

create function public.enforce_platform_notification_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cfg public.platform_notification_settings%rowtype;
begin
  select * into cfg from public.platform_notification_settings where id = true for share;
  if not found or not cfg.in_app_enabled or (new.category = 'maintenance' and not cfg.maintenance_enabled) or (new.category = 'payment' and not cfg.payment_enabled) then
    raise exception 'platform_notification_disabled' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_platform_notification_settings() from public, anon, authenticated;
create trigger enforce_platform_notification_settings before insert on public.platform_notifications for each row execute function public.enforce_platform_notification_settings();


-- Migration: 202611180025_platform_storage_settings.sql
-- Planning metadata only; this table does not schedule or execute backups.
create table public.platform_storage_settings (
  id boolean primary key default true check (id),
  backup_frequency text not null default 'none' check (backup_frequency in ('none','daily','weekly','monthly')),
  backup_time time not null default '02:00',
  backup_weekday integer not null default 1 check (backup_weekday between 1 and 7),
  backup_monthday integer not null default 1 check (backup_monthday between 1 and 28),
  retention_days integer not null default 30 check (retention_days between 1 and 3650),
  notes text not null default '' check (length(notes) <= 1000),
  updated_at timestamptz not null default now()
);
insert into public.platform_storage_settings(id) values (true);
alter table public.platform_storage_settings enable row level security;
revoke all on public.platform_storage_settings from public, anon, authenticated;
grant select, update on public.platform_storage_settings to authenticated;
create policy platform_storage_settings_read on public.platform_storage_settings for select to authenticated using (public.is_platform_admin());
create policy platform_storage_settings_update on public.platform_storage_settings for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());


-- Migration: 202611180026_platform_operations.sql
create table public.platform_operations_settings (
  id boolean primary key default true check (id),
  maintenance_enabled boolean not null default false,
  maintenance_message text not null default 'Hệ thống đang bảo trì. Vui lòng quay lại sau.' check (length(trim(maintenance_message)) between 1 and 1000),
  public_signup_enabled boolean not null default true,
  max_notification_length integer not null default 4000 check (max_notification_length between 100 and 4000),
  updated_at timestamptz not null default now()
);
insert into public.platform_operations_settings(id) values (true);
alter table public.platform_operations_settings enable row level security;
revoke all on public.platform_operations_settings from public, anon, authenticated;
grant select on public.platform_operations_settings to anon, authenticated;
grant update on public.platform_operations_settings to authenticated;
create policy platform_operations_read on public.platform_operations_settings for select to anon, authenticated using (true);
create policy platform_operations_update on public.platform_operations_settings for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Auth app metadata is set by Supabase's privileged admin API, not public signup.
-- Admin-created users remain available while public registrations are paused.
create function public.enforce_public_signup_setting() returns trigger
language plpgsql security definer set search_path = '' as $$
declare signup_allowed boolean;
begin
  if new.raw_app_meta_data ->> 'created_by_platform_admin' = 'true' or new.raw_app_meta_data ->> 'account_kind' = 'platform_admin' then return new; end if;
  select public_signup_enabled into signup_allowed from public.platform_operations_settings where id = true for share;
  if signup_allowed is distinct from true then raise exception 'public_registration_disabled' using errcode = 'P0001'; end if;
  return new;
end;
$$;
revoke all on function public.enforce_public_signup_setting() from public, anon, authenticated;
create trigger enforce_public_signup_setting before insert on auth.users for each row execute function public.enforce_public_signup_setting();

create function public.enforce_notification_length() returns trigger
language plpgsql security definer set search_path = '' as $$
declare max_length integer;
begin
  select max_notification_length into max_length from public.platform_operations_settings where id = true for share;
  if max_length is null or length(trim(new.body)) > max_length then raise exception 'notification_length_exceeded' using errcode = 'P0001'; end if;
  return new;
end;
$$;
revoke all on function public.enforce_notification_length() from public, anon, authenticated;
create trigger enforce_notification_length before insert on public.platform_notifications for each row execute function public.enforce_notification_length();


-- Migration: 202611180027_store_staff_invitations.sql
-- Invitations add only the existing staff role. The recipient must accept with
-- a verified matching account; no email is sent by this migration.
create table public.store_staff_invitations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  email text not null check (length(email) between 3 and 254),
  status text not null default 'pending' check (status in ('pending','accepted','declined','revoked','expired')),
  invited_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  responded_at timestamptz
);
create unique index store_staff_pending_email_idx on public.store_staff_invitations(store_id, lower(email)) where status = 'pending';
create index store_staff_invitations_email_idx on public.store_staff_invitations(lower(email), status);
alter table public.store_staff_invitations enable row level security;
revoke all on public.store_staff_invitations from public, anon, authenticated;
grant select on public.store_staff_invitations to authenticated;
create policy store_staff_invites_owner_read on public.store_staff_invitations for select to authenticated using (public.has_store_role(store_id, array['owner']::public.store_member_role[]));

-- Mutations go through checked functions rather than broad direct membership grants.
revoke insert, update, delete on public.store_members from authenticated;

create function public.owner_store_staff_list(target_store uuid)
returns table(user_id uuid, role public.store_member_role, joined_at timestamptz, email text, display_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_store_role(target_store, array['owner']::public.store_member_role[]) then raise exception 'not authorized' using errcode = '42501'; end if;
  return query select m.user_id, m.role, m.created_at, u.email::text, coalesce(nullif(p.display_name,''), u.raw_user_meta_data->>'display_name', '')
    from public.store_members m join auth.users u on u.id = m.user_id left join public.profiles p on p.id = m.user_id
    where m.store_id = target_store order by m.created_at, m.user_id;
end;
$$;

create function public.owner_invite_store_staff(target_store uuid, target_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare normalized text := lower(trim(coalesce(target_email,'')));
begin
  if not public.has_store_role(target_store, array['owner']::public.store_member_role[]) then raise exception 'not authorized' using errcode = '42501'; end if;
  if length(normalized) > 254 or normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'invalid email' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_store::text, 173));
  if exists(select 1 from public.store_members m join auth.users u on u.id = m.user_id where m.store_id = target_store and lower(u.email) = normalized) then raise exception 'already a member' using errcode = '23505'; end if;
  update public.store_staff_invitations set status = 'expired' where store_id = target_store and lower(email) = normalized and status = 'pending' and expires_at <= now();
  insert into public.store_staff_invitations(store_id, email, invited_by) values(target_store, normalized, auth.uid());
end;
$$;

create function public.owner_revoke_store_staff(target_store uuid, target_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_store_role(target_store, array['owner']::public.store_member_role[]) then raise exception 'not authorized' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_store::text, 173));
  delete from public.store_members where store_id = target_store and user_id = target_user and role = 'staff';
  if not found then raise exception 'staff not found' using errcode = 'P0002'; end if;
  update public.store_staff_invitations set status = 'revoked', responded_at = now() where store_id = target_store and status = 'pending' and lower(email) = (select lower(u.email) from auth.users u where u.id = target_user);
end;
$$;

create function public.owner_cancel_staff_invite(target_store uuid, invite_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_store_role(target_store, array['owner']::public.store_member_role[]) then raise exception 'not authorized' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_store::text, 173));
  update public.store_staff_invitations set status = 'revoked', responded_at = now() where id = invite_id and store_id = target_store and status = 'pending';
  if not found then raise exception 'invitation not found' using errcode = 'P0002'; end if;
end;
$$;

create function public.my_store_staff_invitations()
returns table(id uuid, store_name text, store_slug text, created_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.id, s.name, s.slug, i.created_at, i.expires_at
  from public.store_staff_invitations i join public.stores s on s.id = i.store_id join auth.users u on u.id = auth.uid()
  where u.email_confirmed_at is not null and lower(u.email) = lower(i.email) and i.status = 'pending' and i.expires_at > now()
    and not public.is_dedicated_platform_account(u.id)
  order by i.created_at desc, i.id;
$$;

create function public.respond_store_staff_invitation(invite_id uuid, accept_invitation boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare invitation public.store_staff_invitations%rowtype; user_email text; target_store uuid;
begin
  if auth.uid() is null or accept_invitation is null or public.is_dedicated_platform_account(auth.uid()) then raise exception 'not authorized' using errcode = '42501'; end if;
  select lower(email) into user_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  select store_id into target_store from public.store_staff_invitations where id = invite_id;
  if target_store is null then raise exception 'invitation unavailable' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_store::text, 173));
  select * into invitation from public.store_staff_invitations where id = invite_id for update;
  if not found or user_email is null or user_email <> lower(invitation.email) or invitation.status <> 'pending' or invitation.expires_at <= now() then raise exception 'invitation unavailable' using errcode = '22023'; end if;
  if accept_invitation then
    insert into public.store_members(store_id, user_id, role) values(invitation.store_id, auth.uid(), 'staff') on conflict (store_id, user_id) do nothing;
  end if;
  update public.store_staff_invitations set status = case when accept_invitation then 'accepted' else 'declined' end, responded_at = now() where id = invite_id;
end;
$$;
revoke all on function public.owner_store_staff_list(uuid), public.owner_invite_store_staff(uuid,text), public.owner_revoke_store_staff(uuid,uuid), public.owner_cancel_staff_invite(uuid,uuid), public.my_store_staff_invitations(), public.respond_store_staff_invitation(uuid,boolean) from public, anon, authenticated;
grant execute on function public.owner_store_staff_list(uuid), public.owner_invite_store_staff(uuid,text), public.owner_revoke_store_staff(uuid,uuid), public.owner_cancel_staff_invite(uuid,uuid), public.my_store_staff_invitations(), public.respond_store_staff_invitation(uuid,boolean) to authenticated;


-- Migration: 202611180028_owner_create_staff.sql
-- Allow trusted server-created store staff while public registration is paused.
create or replace function public.enforce_public_signup_setting() returns trigger
language plpgsql security definer set search_path = '' as $$
declare signup_allowed boolean;
begin
  if new.raw_app_meta_data ->> 'created_by_platform_admin' = 'true'
    or new.raw_app_meta_data ->> 'account_kind' = 'platform_admin'
    or new.raw_app_meta_data ->> 'created_by_store_owner' = 'true' then return new; end if;
  select public_signup_enabled into signup_allowed from public.platform_operations_settings where id = true for share;
  if signup_allowed is distinct from true then raise exception 'public_registration_disabled' using errcode = 'P0001'; end if;
  return new;
end;
$$;

create function public.owner_can_create_staff(target_store uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_store_role(target_store, array['owner']::public.store_member_role[]);
$$;

create function public.owner_attach_created_staff(target_store uuid, target_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare new_user auth.users%rowtype;
begin
  if not public.has_store_role(target_store, array['owner']::public.store_member_role[]) then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into new_user from auth.users where id = target_user for update;
  if not found or new_user.email_confirmed_at is not null or new_user.created_at < now() - interval '15 minutes'
    or new_user.raw_app_meta_data->>'created_by_store_owner' is distinct from 'true'
    or new_user.raw_app_meta_data->>'staff_store_id' is distinct from target_store::text
    or new_user.raw_app_meta_data->>'staff_creator_id' is distinct from auth.uid()::text
    or public.is_dedicated_platform_account(target_user)
    or exists(select 1 from public.store_members where user_id = target_user) then
    raise exception 'invalid newly created staff account' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_store::text, 173));
  insert into public.store_members(store_id, user_id, role) values(target_store, target_user, 'staff');
end;
$$;
revoke all on function public.owner_can_create_staff(uuid), public.owner_attach_created_staff(uuid,uuid) from public, anon, authenticated;
grant execute on function public.owner_can_create_staff(uuid), public.owner_attach_created_staff(uuid,uuid) to authenticated;


-- Migration: 202611180029_remove_owner_create_staff.sql
-- Remove direct staff-account creation while retaining invitation-based membership.
drop function if exists public.owner_attach_created_staff(uuid, uuid);
drop function if exists public.owner_can_create_staff(uuid);

create or replace function public.enforce_public_signup_setting() returns trigger
language plpgsql security definer set search_path = '' as $$
declare signup_allowed boolean;
begin
  if new.raw_app_meta_data ->> 'created_by_platform_admin' = 'true'
    or new.raw_app_meta_data ->> 'account_kind' = 'platform_admin' then return new; end if;
  select public_signup_enabled into signup_allowed from public.platform_operations_settings where id = true for share;
  if signup_allowed is distinct from true then raise exception 'public_registration_disabled' using errcode = 'P0001'; end if;
  return new;
end;
$$;


-- Migration: 202611180030_platform_staff_invitations.sql
create table public.platform_staff_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (length(email) between 3 and 254),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending','processing','accepted','revoked')),
  invited_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_user_id uuid references auth.users(id),
  accepted_at timestamptz
);
create unique index platform_staff_invitation_pending_email on public.platform_staff_invitations(lower(email)) where status in ('pending','processing');
alter table public.platform_staff_invitations enable row level security;
revoke all on public.platform_staff_invitations from public, anon, authenticated;
grant select on public.platform_staff_invitations to authenticated;
grant select, insert, update on public.platform_staff_invitations to service_role;
create policy platform_staff_invitations_admin_read on public.platform_staff_invitations for select to authenticated using (public.is_platform_admin());

-- Only the server's service role may reserve the one-time token.
create function public.reserve_platform_staff_invitation(requested_hash text)
returns table(id uuid, email text) language sql security definer set search_path = '' as $$
  update public.platform_staff_invitations i set status = 'processing'
  where i.token_hash = requested_hash and i.status = 'pending' and i.expires_at > now()
  returning i.id, i.email;
$$;
revoke all on function public.reserve_platform_staff_invitation(text) from public, anon, authenticated;
grant execute on function public.reserve_platform_staff_invitation(text) to service_role;


-- Migration: 202611180031_platform_invitation_role.sql
alter table public.platform_staff_invitations
  add column staff_role_label text check (staff_role_label is null or staff_role_label in (
    'super_admin', 'system_admin', 'support_admin', 'finance_admin',
    'sales_admin', 'technical_admin', 'content_admin'
  ));


-- Migration: 202611180032_growdesk_brand.sql
-- Rename the existing default without overwriting a custom platform name.
alter table public.platform_general_settings alter column platform_name set default 'GrowDesk';
update public.platform_general_settings set platform_name = 'GrowDesk', updated_at = now()
where id = true and lower(trim(platform_name)) = 'kingweb';
update public.platform_role_catalog set responsibilities = replace(responsibilities, 'KingWeb', 'GrowDesk')
where code = 'super_admin';


-- Migration: 202611180033_allow_store_without_plan.sql
-- Temporarily allow new stores without an active paid plan. Existing paid subscriptions are preserved.
create or replace function public.create_store_with_merchant_plan(
  store_name text, store_slug text, store_phone text, store_address text, store_location text
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  buyer uuid := auth.uid();
  new_store uuid;
begin
  if buyer is null then raise exception 'sign_in_required'; end if;
  if store_slug is null or char_length(store_slug) > 80 then
    raise exception 'invalid_store_slug';
  end if;
  if store_slug in ('admin', 'api', 'auth', 'chat', 'dashboard', 'demo', 'login', 'merchant-plan', 'store-host', 'track-order', 'www') then
    raise exception 'reserved_store_slug';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(buyer::text, 142));
  if exists (select 1 from public.store_members where user_id = buyer) then
    raise exception 'existing_store';
  end if;
  insert into public.stores (created_by, billing_owner_id, name, slug, phone, address, location, status, accepts_orders)
    values (buyer, case when exists (select 1 from public.merchant_plan_payments where user_id = buyer and status = 'approved' and valid_until > now()) then buyer else null end, store_name, store_slug, store_phone, store_address, store_location::extensions.geography, 'active', false)
    returning id into new_store;
  insert into public.store_members (store_id, user_id, role) values (new_store, buyer, 'owner');
end;
$$;



-- Migration: 202611180034_store_business_category.sql
-- Existing stores may be assigned an industry later; new stores must choose one.
alter table public.stores add column business_category_id uuid references public.business_categories(id) on delete restrict;
create index stores_business_category_id_idx on public.stores(business_category_id);

create function public.get_business_category_options()
returns table(id uuid, name text) language sql stable security definer set search_path = '' as $$
  select c.id, c.name from public.business_categories c where auth.uid() is not null order by c.name, c.id;
$$;
revoke all on function public.get_business_category_options() from public, anon, authenticated;
grant execute on function public.get_business_category_options() to authenticated;

-- Close the old five-argument entry point so clients cannot bypass the required choice.
revoke all on function public.create_store_with_merchant_plan(text,text,text,text,text) from public, anon, authenticated;
create function public.create_store_with_merchant_plan(
  store_name text, store_slug text, store_phone text, store_address text, store_location text, category_id uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare buyer uuid := auth.uid(); new_store uuid;
begin
  if buyer is null then raise exception 'sign_in_required'; end if;
  if category_id is null or not exists (select 1 from public.business_categories where id = category_id) then raise exception 'invalid_business_category'; end if;
  if store_slug is null or char_length(store_slug) > 80 then raise exception 'invalid_store_slug'; end if;
  if store_slug in ('admin', 'api', 'auth', 'chat', 'dashboard', 'demo', 'login', 'merchant-plan', 'store-host', 'track-order', 'www') then raise exception 'reserved_store_slug'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(buyer::text, 142));
  if exists (select 1 from public.store_members where user_id = buyer) then raise exception 'existing_store'; end if;
  insert into public.stores (created_by, billing_owner_id, name, slug, phone, address, location, status, accepts_orders, business_category_id)
    values (buyer, case when exists (select 1 from public.merchant_plan_payments where user_id = buyer and status = 'approved' and valid_until > now()) then buyer else null end, store_name, store_slug, store_phone, store_address, store_location::extensions.geography, 'active', false, category_id)
    returning id into new_store;
  insert into public.store_members (store_id, user_id, role) values (new_store, buyer, 'owner');
end; $$;
revoke all on function public.create_store_with_merchant_plan(text,text,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.create_store_with_merchant_plan(text,text,text,text,text,uuid) to authenticated;


-- Migration: 202611180035_store_private_owner_fields.sql
-- Limit direct API access to public store columns. Internal owner IDs must be
-- accessed via authorized server-side code or the scoped function below.
revoke select on public.stores from public, anon, authenticated;
revoke select (created_by, billing_owner_id) on public.stores from public, anon, authenticated;
do $$
declare visible_columns text;
begin
  select pg_catalog.string_agg(pg_catalog.format('%I', a.attname), ', ' order by a.attnum)
    into visible_columns
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.stores'::regclass and a.attnum > 0 and not a.attisdropped
      and a.attname not in ('created_by', 'billing_owner_id');
  execute 'grant select (' || visible_columns || ') on public.stores to anon, authenticated';
end $$;

create function public.get_store_billing_owner(requested_store uuid)
returns table(billing_owner_id uuid) language sql stable security definer set search_path = '' as $$
  select s.billing_owner_id from public.stores s
  where s.id = requested_store and (public.is_platform_admin() or public.has_store_role(s.id));
$$;
revoke all on function public.get_store_billing_owner(uuid) from public, anon, authenticated;
grant execute on function public.get_store_billing_owner(uuid) to authenticated;


-- Migration: 202611180036_store_modules.sql
create table public.platform_modules (
  code text primary key,
  name text not null,
  description text not null default '',
  default_enabled boolean not null default true
);
insert into public.platform_modules(code, name, description) values ('brands', 'Quản lý thương hiệu', 'Quản lý thương hiệu và gắn thương hiệu cho sản phẩm.');
create table public.store_module_settings (
  store_id uuid not null references public.stores(id) on delete cascade,
  module_code text not null references public.platform_modules(code) on delete restrict,
  enabled boolean not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (store_id, module_code)
);
alter table public.platform_modules enable row level security;
alter table public.store_module_settings enable row level security;
revoke all on public.platform_modules, public.store_module_settings from public, anon, authenticated;
grant select on public.platform_modules, public.store_module_settings to authenticated;
create policy modules_admin_read on public.platform_modules for select to authenticated using (public.is_platform_admin());
create policy store_module_settings_admin_read on public.store_module_settings for select to authenticated using (public.is_platform_admin());

create function public.store_module_enabled(target_store uuid, target_module text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (public.is_platform_admin() or public.has_store_role(target_store) or (select auth.role()) = 'service_role') and coalesce((select coalesce(s.enabled, m.default_enabled) from public.platform_modules m left join public.store_module_settings s on s.module_code=m.code and s.store_id=target_store where m.code=target_module), false);
$$;
revoke all on function public.store_module_enabled(uuid,text) from public, anon, authenticated;
grant execute on function public.store_module_enabled(uuid,text) to authenticated, service_role;
-- Restrict direct access to the brand table, including requests that bypass the app.
create policy store_brands_module_enabled on public.store_brands as restrictive for all to authenticated
  using (public.is_platform_admin() or public.store_module_enabled(store_id, 'brands'))
  with check (public.is_platform_admin() or public.store_module_enabled(store_id, 'brands'));

create function public.guard_product_brand_module()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.brand_id is not null) or (tg_op = 'UPDATE' and new.brand_id is distinct from old.brand_id) then
    if not public.is_platform_admin() and (select auth.role()) is distinct from 'service_role' and not public.store_module_enabled(new.store_id, 'brands') then
      raise exception 'brand_module_disabled' using errcode = '42501';
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.guard_product_brand_module() from public, anon, authenticated;
create trigger product_brand_module_guard before insert or update of brand_id on public.products for each row execute function public.guard_product_brand_module();

create function public.admin_set_store_module(target_store uuid, target_module text, next_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.is_platform_admin() is not true then raise exception 'not authorized' using errcode='42501'; end if;
  if next_enabled is null or not exists(select 1 from public.stores where id=target_store) or not exists(select 1 from public.platform_modules where code=target_module) then raise exception 'invalid module or store' using errcode='22023'; end if;
  insert into public.store_module_settings(store_id,module_code,enabled,updated_by) values(target_store,target_module,next_enabled,auth.uid())
  on conflict(store_id,module_code) do update set enabled=excluded.enabled, updated_by=excluded.updated_by, updated_at=now();
end; $$;
revoke all on function public.admin_set_store_module(uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.admin_set_store_module(uuid,text,boolean) to authenticated;


-- Migration: 202611180037_category_modules.sql
create table public.business_category_module_settings (
  category_id uuid not null references public.business_categories(id) on delete cascade,
  module_code text not null references public.platform_modules(code) on delete cascade,
  enabled boolean not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (category_id, module_code)
);
alter table public.business_category_module_settings enable row level security;
revoke all on public.business_category_module_settings from public, anon, authenticated;
grant select on public.business_category_module_settings to authenticated;
create policy category_module_admin_read on public.business_category_module_settings for select to authenticated using (public.is_platform_admin());

-- Per-store choice wins, then the category setting, then the global default.
create or replace function public.store_module_enabled(target_store uuid, target_module text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select coalesce(sm.enabled, cm.enabled, m.default_enabled)
    from public.stores st cross join public.platform_modules m
    left join public.store_module_settings sm on sm.store_id=st.id and sm.module_code=m.code
    left join public.business_category_module_settings cm on cm.category_id=st.business_category_id and cm.module_code=m.code
    where st.id=target_store and m.code=target_module
      and (public.is_platform_admin() or public.has_store_role(st.id) or (select auth.role()) = 'service_role')), false);
$$;
create function public.admin_set_category_module(target_category uuid, target_module text, next_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.is_platform_admin() is not true then raise exception 'not authorized' using errcode='42501'; end if;
  if next_enabled is null or not exists(select 1 from public.business_categories where id=target_category) or not exists(select 1 from public.platform_modules where code=target_module) then raise exception 'invalid category or module' using errcode='22023'; end if;
  insert into public.business_category_module_settings(category_id,module_code,enabled,updated_by) values(target_category,target_module,next_enabled,auth.uid())
  on conflict(category_id,module_code) do update set enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=now();
end; $$;
revoke all on function public.admin_set_category_module(uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.admin_set_category_module(uuid,text,boolean) to authenticated;

create function public.admin_reset_store_module(target_store uuid, target_module text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.is_platform_admin() is not true then raise exception 'not authorized' using errcode='42501'; end if;
  if not exists(select 1 from public.stores where id=target_store) or not exists(select 1 from public.platform_modules where code=target_module) then raise exception 'invalid store or module' using errcode='22023'; end if;
  delete from public.store_module_settings where store_id=target_store and module_code=target_module;
end; $$;
revoke all on function public.admin_reset_store_module(uuid,text) from public, anon, authenticated;
grant execute on function public.admin_reset_store_module(uuid,text) to authenticated;


-- Migration: 202611180038_product_variant_drafts.sql
-- Variant drafts are private to store members and are not connected to checkout.
create table public.product_variant_drafts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null,
  attributes jsonb not null check (jsonb_typeof(attributes) = 'object' and attributes <> '{}'::jsonb and octet_length(attributes::text) <= 4000),
  sku text check (sku is null or length(trim(sku)) between 1 and 100),
  price_vnd bigint not null check (price_vnd between 0 and 1000000000),
  stock_quantity integer not null default 0 check (stock_quantity between 0 and 10000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(product_id, store_id) references public.products(id, store_id) on delete cascade,
  unique(product_id, attributes)
);
create unique index product_variant_drafts_sku_unique on public.product_variant_drafts(store_id, lower(trim(sku))) where sku is not null;
alter table public.product_variant_drafts enable row level security;
revoke all on public.product_variant_drafts from public, anon, authenticated;
grant select, insert, update, delete on public.product_variant_drafts to authenticated;
create policy variants_store_access on public.product_variant_drafts for all to authenticated
  using (public.has_store_role(store_id)) with check (public.has_store_role(store_id));


-- Migration: 202611180039_create_product_variants.sql
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


-- Migration: 202611180040_category_merchandise_mode.sql
alter table public.business_categories add column merchandise_mode text not null default 'general' check (merchandise_mode in ('general','retail','food'));
-- Map only the two existing, unambiguous categories; admins can adjust each category later.
update public.business_categories set merchandise_mode = 'retail' where slug = 'thoi-trang';
update public.business_categories set merchandise_mode = 'food' where slug = 'quan-coffee';
create function public.get_store_merchandise_mode(target_store uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select coalesce(c.merchandise_mode,'general') from public.stores s left join public.business_categories c on c.id=s.business_category_id where s.id=target_store and (public.has_store_role(s.id) or public.is_platform_admin())), 'general');
$$;
revoke all on function public.get_store_merchandise_mode(uuid) from public, anon, authenticated;
grant execute on function public.get_store_merchandise_mode(uuid) to authenticated;


-- Migration: 202611180041_assign_store_category.sql
-- Only platform admins may assign or change the industry of an existing store.
create function public.admin_set_store_business_category(target_store uuid, target_category uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.is_platform_admin() is not true then raise exception 'not authorized' using errcode = '42501'; end if;
  if target_category is null or not exists(select 1 from public.business_categories where id = target_category) then raise exception 'invalid category' using errcode = '22023'; end if;
  update public.stores set business_category_id = target_category where id = target_store;
  if not found then raise exception 'store not found' using errcode = 'P0002'; end if;
end; $$;
revoke all on function public.admin_set_store_business_category(uuid,uuid) from public, anon, authenticated;
grant execute on function public.admin_set_store_business_category(uuid,uuid) to authenticated;


-- Migration: 202611180042_public_store_mode.sql
-- Only the public presentation mode of an active storefront is exposed.
create function public.get_public_store_merchandise_mode(target_store uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select coalesce(c.merchandise_mode,'general') from public.stores s left join public.business_categories c on c.id=s.business_category_id where s.id=target_store and s.status='active'), 'general');
$$;
revoke all on function public.get_public_store_merchandise_mode(uuid) from public, anon, authenticated;
grant execute on function public.get_public_store_merchandise_mode(uuid) to anon, authenticated;


commit;
