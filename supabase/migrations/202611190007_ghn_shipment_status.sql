alter table public.store_ghn_shipments
  add column provider_status text,
  add column status_checked_at timestamptz;