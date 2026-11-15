-- Receive SePay bank-transfer notifications and confirm matching QR orders.

create table public.store_sepay_webhook_keys (
  store_id uuid primary key references public.stores (id) on delete cascade,
  secret_hash text not null unique check (secret_hash ~ '^[0-9a-f]{64}$'),
  enabled boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.store_sepay_webhook_keys enable row level security;
revoke all on public.store_sepay_webhook_keys from public, anon, authenticated;
grant select, insert, update, delete on public.store_sepay_webhook_keys to service_role;

create table public.bank_transfer_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider = 'sepay'),
  provider_transaction_id text not null,
  store_id uuid not null references public.stores (id) on delete cascade,
  order_id uuid references public.orders (id) on delete set null,
  payment_reference text not null,
  account_number text not null,
  amount_vnd bigint not null check (amount_vnd > 0),
  transfer_content text not null default '',
  result text not null check (result in (
    'confirmed', 'unmatched', 'account_mismatch', 'amount_mismatch',
    'already_paid', 'closed_order'
  )),
  received_at timestamptz not null default now(),
  unique (provider, provider_transaction_id)
);

create index bank_transfer_webhook_events_store_received_idx
  on public.bank_transfer_webhook_events (store_id, received_at desc);

alter table public.bank_transfer_webhook_events enable row level security;
revoke all on public.bank_transfer_webhook_events from public, anon, authenticated;
grant select, insert, update on public.bank_transfer_webhook_events to service_role;

alter table public.orders
  add column payment_confirmation_source text not null default 'manual'
    check (payment_confirmation_source in ('manual', 'sepay'));

create function public.get_store_sepay_webhook_status(requested_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status jsonb;
begin
  if not (select public.has_store_role(requested_store_id))
    and not (select public.is_platform_admin()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'has_key', (k.secret_hash is not null),
    'enabled', coalesce(k.enabled, false)
  )
  into v_status
  from (select requested_store_id as id) as requested
  left join public.store_sepay_webhook_keys as k on k.store_id = requested.id;

  return coalesce(v_status, '{"has_key":false,"enabled":false}'::jsonb);
end;
$$;

create function public.reset_store_sepay_webhook_key(requested_store_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.has_store_role(requested_store_id, array['owner']::public.store_member_role[])) then
    raise exception 'owner role required' using errcode = '42501';
  end if;

  delete from public.store_sepay_webhook_keys
  where store_id = requested_store_id;
end;
$$;

create function public.process_sepay_bank_transfer(
  requested_store_id uuid,
  requested_transaction_id text,
  requested_account_number text,
  requested_amount_vnd bigint,
  requested_transfer_content text,
  requested_payment_reference text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_order public.orders%rowtype;
  v_result text := 'unmatched';
begin
  if requested_store_id is null
    or length(trim(coalesce(requested_transaction_id, ''))) not between 1 and 120
    or length(trim(coalesce(requested_account_number, ''))) not between 1 and 30
    or requested_amount_vnd is null or requested_amount_vnd <= 0
    or length(trim(coalesce(requested_payment_reference, ''))) not between 1 and 80 then
    raise exception 'invalid bank transfer event' using errcode = '22023';
  end if;

  insert into public.bank_transfer_webhook_events (
    provider, provider_transaction_id, store_id, payment_reference,
    account_number, amount_vnd, transfer_content, result
  ) values (
    'sepay', trim(requested_transaction_id), requested_store_id,
    upper(trim(requested_payment_reference)), trim(requested_account_number),
    requested_amount_vnd, left(coalesce(requested_transfer_content, ''), 500), 'unmatched'
  )
  on conflict (provider, provider_transaction_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return 'duplicate';
  end if;

  select * into v_order
  from public.orders
  where store_id = requested_store_id
    and payment_reference = upper(trim(requested_payment_reference))
    and payment_method = 'bank_transfer'
  for update;

  if not found then
    return v_result;
  end if;

  if v_order.payment_account_number <> trim(requested_account_number) then
    v_result := 'account_mismatch';
  elsif v_order.total_vnd <> requested_amount_vnd then
    v_result := 'amount_mismatch';
  elsif v_order.status in ('cancelled', 'rejected') then
    v_result := 'closed_order';
  elsif v_order.payment_status = 'paid' then
    v_result := 'already_paid';
  elsif v_order.payment_status <> 'awaiting_payment' then
    v_result := 'unmatched';
  else
    v_result := 'confirmed';
    update public.orders
    set payment_status = 'paid',
        payment_confirmed_at = now(),
        payment_confirmed_by = null,
        payment_confirmation_source = 'sepay'
    where id = v_order.id;
  end if;

  update public.bank_transfer_webhook_events
  set order_id = v_order.id,
      result = v_result
  where id = v_event_id;

  return v_result;
end;
$$;

revoke all on function public.get_store_sepay_webhook_status(uuid) from public, anon;
grant execute on function public.get_store_sepay_webhook_status(uuid) to authenticated;

revoke all on function public.reset_store_sepay_webhook_key(uuid) from public, anon;
grant execute on function public.reset_store_sepay_webhook_key(uuid) to authenticated;

revoke all on function public.process_sepay_bank_transfer(uuid, text, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.process_sepay_bank_transfer(uuid, text, text, bigint, text, text) to service_role;
