-- Add an owner-visible DNS challenge and a public resolver for verified hosts.
alter table public.store_domains
  add column if not exists verification_token text not null
    default replace(gen_random_uuid()::text, '-', '');

create or replace function public.resolve_custom_store_hostname(requested_hostname text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.slug
  from public.store_domains d
  join public.stores s on s.id = d.store_id
  where d.hostname = lower(trim(requested_hostname))
    and d.domain_type = 'custom'
    and d.verification_status = 'verified'
    and s.status = 'active'
  limit 1;
$$;

revoke all on function public.resolve_custom_store_hostname(text) from public;
grant execute on function public.resolve_custom_store_hostname(text)
  to anon, authenticated, service_role;
