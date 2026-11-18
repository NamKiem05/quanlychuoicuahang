-- Buyer access is limited by auth.uid(); no table-level customer access is added.
begin;
create function public.customer_orders(requested_offset integer default 0)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'public_code', q.public_code, 'status', q.status,
    'created_at', q.created_at, 'total_vnd', q.total_vnd,
    'payment_status', q.payment_status, 'store_name', q.store_name,
    'store_slug', q.store_slug, 'item_count', q.item_count
  ) order by q.created_at desc, q.id desc), '[]'::jsonb)
  from (
    select o.id, o.public_code, o.status, o.created_at, o.total_vnd, o.payment_status,
      s.name as store_name, s.slug as store_slug,
      (select coalesce(sum(i.quantity), 0) from public.order_items i where i.order_id = o.id) as item_count
    from public.orders o join public.stores s on s.id = o.store_id
    where auth.uid() is not null and o.customer_user_id = auth.uid()
    order by o.created_at desc, o.id desc
    limit 21 offset greatest(0, least(coalesce(requested_offset, 0), 10000))
  ) q;
$$;

create function public.customer_order_detail(requested_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', o.id, 'public_code', o.public_code, 'status', o.status,
    'created_at', o.created_at, 'store_name', s.name, 'store_slug', s.slug,
    'customer_name', o.customer_name, 'customer_phone', o.customer_phone,
    'customer_email', o.customer_email, 'customer_note', o.customer_note,
    'fulfillment', o.fulfillment, 'delivery_address', o.delivery_address,
    'payment_method', o.payment_method, 'payment_status', o.payment_status,
    'subtotal_vnd', o.subtotal_vnd, 'delivery_fee_vnd', o.delivery_fee_vnd,
    'discount_vnd', o.discount_vnd, 'total_vnd', o.total_vnd,
    'promotion_code', o.promotion_code, 'cancellation_request_status', o.cancellation_request_status,
    'refund_amount_vnd', o.refund_amount_vnd, 'refunded_at', o.refunded_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'name', i.product_name_snapshot, 'quantity', i.quantity,
      'unit_price_vnd', i.unit_price_snapshot_vnd, 'sku', i.variant_sku_snapshot
    ) order by i.created_at, i.id) from public.order_items i where i.order_id = o.id), '[]'::jsonb)
  )
  from public.orders o join public.stores s on s.id = o.store_id
  where auth.uid() is not null and o.customer_user_id = auth.uid() and o.id = requested_order;
$$;
revoke all on function public.customer_orders(integer), public.customer_order_detail(uuid) from public, anon, authenticated;
grant execute on function public.customer_orders(integer), public.customer_order_detail(uuid) to authenticated;
commit;
