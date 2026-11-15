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
