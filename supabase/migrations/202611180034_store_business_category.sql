-- Existing stores may be assigned an industry later; new stores must choose one.
alter table public.stores add column business_category_id uuid references public.business_categories(id) on delete restrict;
create index stores_business_category_id_idx on public.stores(business_category_id);

create function public.get_business_category_options()
returns table(id uuid, name text) language sql stable security definer set search_path = '' as $$
  select c.id, c.name from public.business_categories c where auth.uid() is not null order by c.name, c.id;
$$;
revoke all on function public.get_business_category_options() from public, anon, authenticated;
grant execute on function public.get_business_category_options() to authenticated;

-- Close the old five-argument entry point so clients cannot bypass the required choice.
revoke all on function public.create_store_with_merchant_plan(text,text,text,text,text) from public, anon, authenticated;
create function public.create_store_with_merchant_plan(
  store_name text, store_slug text, store_phone text, store_address text, store_location text, category_id uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare buyer uuid := auth.uid(); new_store uuid;
begin
  if buyer is null then raise exception 'sign_in_required'; end if;
  if category_id is null or not exists (select 1 from public.business_categories where id = category_id) then raise exception 'invalid_business_category'; end if;
  if store_slug is null or char_length(store_slug) > 80 then raise exception 'invalid_store_slug'; end if;
  if store_slug in ('admin', 'api', 'auth', 'chat', 'dashboard', 'demo', 'login', 'merchant-plan', 'store-host', 'track-order', 'www') then raise exception 'reserved_store_slug'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(buyer::text, 142));
  if exists (select 1 from public.store_members where user_id = buyer) then raise exception 'existing_store'; end if;
  insert into public.stores (created_by, billing_owner_id, name, slug, phone, address, location, status, accepts_orders, business_category_id)
    values (buyer, case when exists (select 1 from public.merchant_plan_payments where user_id = buyer and status = 'approved' and valid_until > now()) then buyer else null end, store_name, store_slug, store_phone, store_address, store_location::extensions.geography, 'active', false, category_id)
    returning id into new_store;
  insert into public.store_members (store_id, user_id, role) values (new_store, buyer, 'owner');
end; $$;
revoke all on function public.create_store_with_merchant_plan(text,text,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.create_store_with_merchant_plan(text,text,text,text,text,uuid) to authenticated;
