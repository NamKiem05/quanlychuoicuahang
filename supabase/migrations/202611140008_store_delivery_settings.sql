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
