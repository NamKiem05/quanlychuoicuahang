begin;

-- One preference per store. Bindings remain immutable eligibility/history records.
create table public.store_shipping_selections (
  store_id uuid primary key references public.stores(id) on delete restrict,
  account_version_id uuid not null,
  provider_code text not null check (provider_code = 'ghn'),
  selection_policy text not null,
  revision uuid not null default gen_random_uuid(),
  foreign key (account_version_id, store_id, provider_code, selection_policy)
    references public.shipping_account_version_store_bindings
      (account_version_id, store_id, provider_code, selection_policy)
);

alter table public.store_shipping_selections enable row level security;
revoke all on public.store_shipping_selections from public, anon, authenticated, service_role;

create function public.get_store_shipping_configuration(target_store uuid, actor uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'revision', s.revision,
    'selectedVersionId', s.account_version_id,
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'name', a.name, 'scope', v.scope,
        'provider', p.name, 'shopId', v.external_shop_id,
        'verification', v.verification_status, 'enabled', v.enabled,
        'status', case
          when v.revoked_at is not null then 'revoked'
          when not p.catalog_enabled then 'unavailable'
          when v.verification_status = 'failed' then 'failed'
          when v.verification_status <> 'verified' then 'not_checked'
          when not v.enabled then 'disabled'
          else 'available'
        end
      ) order by a.name, v.created_at desc, v.id)
      from public.shipping_provider_account_versions v
      join public.shipping_provider_accounts a on a.id = v.account_id
      join public.shipping_providers p on p.code = v.provider_code
      where v.provider_code = 'ghn' and v.environment = 'staging'
        and ((v.scope = 'shop' and v.store_id = target_store and v.owner_store_key = target_store)
          or (v.scope = 'platform' and exists (
            select 1 from public.shipping_account_version_store_bindings b
            where b.account_version_id = v.id and b.store_id = target_store
              and b.provider_code = v.provider_code and b.selection_policy = 'platform'
          )))
    ), '[]'::jsonb)
  )
  from public.store_members m
  left join public.store_shipping_selections s on s.store_id = m.store_id
  where m.store_id = target_store and m.user_id = actor and m.role = 'owner';
$$;

create function public.select_store_shipping_account(
  target_store uuid, actor uuid, target_version uuid, expected_revision uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_selection public.store_shipping_selections%rowtype;
  version_row public.shipping_provider_account_versions%rowtype;
begin
  perform 1 from public.store_members m
  where m.store_id = target_store and m.user_id = actor and m.role = 'owner'
  for share;
  if not found then return 'forbidden'; end if;

  -- Serialize selections even before the first preference exists.
  perform 1 from public.stores where id = target_store for no key update;
  select * into current_selection from public.store_shipping_selections where store_id = target_store;

  select v.* into version_row
  from public.shipping_provider_account_versions v
  where v.id = target_version and v.provider_code = 'ghn' and v.environment = 'staging'
    and ((v.scope = 'shop' and v.store_id = target_store and v.owner_store_key = target_store)
      or (v.scope = 'platform' and exists (
        select 1 from public.shipping_account_version_store_bindings b
        where b.account_version_id = v.id and b.store_id = target_store
          and b.provider_code = v.provider_code and b.selection_policy = 'platform'
      )))
  for update of v;
  if not found or not version_row.enabled or version_row.revoked_at is not null
    or version_row.verification_status <> 'verified' then return 'unavailable'; end if;

  perform 1 from public.shipping_providers p
  where p.code = version_row.provider_code and p.catalog_enabled for share;
  if not found then return 'unavailable'; end if;
  if current_selection.account_version_id = target_version then return 'saved'; end if;
  if current_selection.revision is distinct from expected_revision then return 'conflict'; end if;

  perform public.bind_shipping_account_version_to_store(target_version, target_store, version_row.scope);
  insert into public.store_shipping_selections (store_id, account_version_id, provider_code, selection_policy)
  values (target_store, target_version, version_row.provider_code, version_row.scope)
  on conflict (store_id) do update set
    account_version_id = excluded.account_version_id,
    provider_code = excluded.provider_code,
    selection_policy = excluded.selection_policy,
    revision = gen_random_uuid();
  return 'saved';
end;
$$;

alter function public.get_store_shipping_configuration(uuid, uuid) owner to postgres;
alter function public.select_store_shipping_account(uuid, uuid, uuid, uuid) owner to postgres;
revoke all on function public.get_store_shipping_configuration(uuid, uuid),
  public.select_store_shipping_account(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_store_shipping_configuration(uuid, uuid),
  public.select_store_shipping_account(uuid, uuid, uuid, uuid) to service_role;

commit;
