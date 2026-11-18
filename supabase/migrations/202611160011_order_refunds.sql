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
