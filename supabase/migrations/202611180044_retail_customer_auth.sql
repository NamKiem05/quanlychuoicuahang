-- Retail orders must be tied to a real, verified account, regardless of which
-- guest-order RPC is used. The other store modes retain their existing flow.
begin;
alter table public.orders add column customer_user_id uuid references auth.users(id) on delete set null;
create index orders_customer_user_id_idx on public.orders(customer_user_id) where customer_user_id is not null;

create function public.require_retail_customer_auth()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  customer uuid := auth.uid();
  retail boolean;
begin
  select coalesce(c.merchandise_mode = 'retail', false) into retail
  from public.stores s left join public.business_categories c on c.id = s.business_category_id
  where s.id = new.store_id;
  if retail then
    if customer is null or not exists (
      select 1 from auth.users u
      where u.id = customer and u.email_confirmed_at is not null
        and coalesce(u.is_anonymous, false) = false
        and (u.banned_until is null or u.banned_until <= now())
    ) then
      raise exception 'retail_customer_login_required' using errcode = '42501';
    end if;
    new.customer_user_id := customer;
  end if;
  return new;
end; $$;
revoke all on function public.require_retail_customer_auth() from public, anon, authenticated;
create trigger require_retail_customer_auth before insert on public.orders
for each row execute function public.require_retail_customer_auth();
commit;
