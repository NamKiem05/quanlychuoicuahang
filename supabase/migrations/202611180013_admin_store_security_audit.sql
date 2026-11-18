-- Initial, intentionally narrow audit trail: selected admin changes to stores.
-- Events performed without an authenticated admin JWT cannot be attributed here.
create table public.admin_store_security_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  store_id uuid not null,
  store_name text not null,
  action text not null check (action in ('updated', 'deleted')),
  changed_fields text[] not null default '{}',
  old_status text,
  new_status text,
  occurred_at timestamptz not null default now()
);
create index admin_store_security_audit_time_idx on public.admin_store_security_audit(occurred_at desc, id);
alter table public.admin_store_security_audit enable row level security;
revoke all on public.admin_store_security_audit from public, anon, authenticated;
grant select on public.admin_store_security_audit to authenticated;
create policy admin_store_security_audit_read on public.admin_store_security_audit for select to authenticated using ((select public.is_platform_admin()));

create function public.audit_admin_store_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare fields text[] := '{}';
begin
  if auth.uid() is null or public.is_platform_admin() is not true then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'DELETE' then
    insert into public.admin_store_security_audit(actor_id, store_id, store_name, action, old_status)
      values(auth.uid(), old.id, old.name, 'deleted', old.status::text);
    return old;
  end if;
  if old.name is distinct from new.name then fields := array_append(fields, 'name'); end if;
  if old.slug is distinct from new.slug then fields := array_append(fields, 'slug'); end if;
  if old.phone is distinct from new.phone then fields := array_append(fields, 'phone'); end if;
  if old.address is distinct from new.address then fields := array_append(fields, 'address'); end if;
  if old.description is distinct from new.description then fields := array_append(fields, 'description'); end if;
  if old.status is distinct from new.status then fields := array_append(fields, 'status'); end if;
  if cardinality(fields) > 0 then
    insert into public.admin_store_security_audit(actor_id, store_id, store_name, action, changed_fields, old_status, new_status)
      values(auth.uid(), new.id, new.name, 'updated', fields,
        case when old.status is distinct from new.status then old.status::text end,
        case when old.status is distinct from new.status then new.status::text end);
  end if;
  return new;
end; $$;
revoke all on function public.audit_admin_store_change() from public, anon, authenticated;
create trigger admin_store_security_audit_trigger after update or delete on public.stores
  for each row execute function public.audit_admin_store_change();
