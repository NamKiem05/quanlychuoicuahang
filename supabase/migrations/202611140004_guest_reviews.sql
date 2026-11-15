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
