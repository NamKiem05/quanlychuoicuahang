-- Allow authenticated store owners to update delivery settings.
-- The existing stores_update_owner RLS policy still limits which store rows
-- can be changed; this grants column-level SQL privileges only.
grant update (delivery_enabled, delivery_radius_m, delivery_fee_vnd)
  on public.stores to authenticated;
