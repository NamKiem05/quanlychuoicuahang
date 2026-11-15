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
