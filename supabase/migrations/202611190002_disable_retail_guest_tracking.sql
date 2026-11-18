-- Retail customers use their authenticated order history.
begin;
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
  where (not exists (
    select 1 from public.business_categories c
    where c.id = s.business_category_id and c.merchandise_mode = 'retail'
  ) or (auth.uid() is not null and o.customer_user_id = auth.uid()))
    and o.public_code = upper(trim(coalesce(requested_public_code, '')))
    and regexp_replace(o.customer_phone, '[^0-9]', '', 'g') =
      regexp_replace(coalesce(requested_customer_phone, ''), '[^0-9]', '', 'g')
  limit 1;
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
    'is_retail', exists(select 1 from public.business_categories c where c.id = s.business_category_id and c.merchandise_mode = 'retail'),
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

  if exists (
    select 1 from public.stores s join public.business_categories c on c.id = s.business_category_id
    where s.id = v_order.store_id and c.merchandise_mode = 'retail'
  ) and (auth.uid() is null or v_order.customer_user_id is distinct from auth.uid()) then
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


commit;
