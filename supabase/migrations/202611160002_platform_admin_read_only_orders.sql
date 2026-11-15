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
