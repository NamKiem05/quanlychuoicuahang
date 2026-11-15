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
