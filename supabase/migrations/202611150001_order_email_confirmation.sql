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
