-- Only future changes can be recorded; past processing history cannot be reconstructed.
create table public.store_order_events (
  id bigint generated always as identity primary key,
  store_id uuid not null,
  order_id uuid not null,
  event_type text not null check (event_type in ('status', 'payment', 'cancellation', 'refund')),
  old_value text,
  new_value text,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (order_id, store_id) references public.orders(id, store_id) on delete cascade
);
create index store_order_events_order_time_idx on public.store_order_events(store_id, order_id, created_at, id);
alter table public.store_order_events enable row level security;
revoke all on public.store_order_events from public, anon, authenticated;
grant select on public.store_order_events to authenticated;
create policy store_order_events_read on public.store_order_events for select to authenticated using (public.has_store_role(store_id));

create function public.record_store_order_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status is distinct from new.status then
    insert into public.store_order_events(store_id, order_id, event_type, old_value, new_value, actor_id)
    values(new.store_id, new.id, 'status', old.status::text, new.status::text, auth.uid());
  end if;
  if old.payment_status is distinct from new.payment_status then
    insert into public.store_order_events(store_id, order_id, event_type, old_value, new_value, actor_id)
    values(new.store_id, new.id, 'payment', old.payment_status::text, new.payment_status::text, auth.uid());
  end if;
  if old.cancellation_request_status is distinct from new.cancellation_request_status then
    insert into public.store_order_events(store_id, order_id, event_type, old_value, new_value, actor_id)
    values(new.store_id, new.id, 'cancellation', old.cancellation_request_status::text, new.cancellation_request_status::text, auth.uid());
  end if;
  if (to_jsonb(old)->>'refunded_at') is distinct from (to_jsonb(new)->>'refunded_at') and (to_jsonb(new)->>'refunded_at') is not null then
    insert into public.store_order_events(store_id, order_id, event_type, new_value, actor_id)
    values(new.store_id, new.id, 'refund', to_jsonb(new)->>'refund_amount_vnd', auth.uid());
  end if;
  return new;
end;
$$;
revoke all on function public.record_store_order_event() from public, anon, authenticated;
create trigger record_store_order_event after update on public.orders for each row execute function public.record_store_order_event();
