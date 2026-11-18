alter table public.stores
  add column banner_urls text[] not null default '{}',
  add constraint stores_banner_urls_valid check (
    cardinality(banner_urls) <= 3
    and coalesce(array_ndims(banner_urls), 1) = 1
    and coalesce(array_lower(banner_urls, 1), 1) = 1
    and array_position(banner_urls, null) is null
    and array_position(banner_urls, '') is null
  );

update public.stores set banner_urls = array[banner_url]
where banner_url is not null and banner_url <> '';

grant update (banner_urls) on public.stores to authenticated;

-- Keep the primary cover compatible with existing readers and older forms.
create function public.sync_store_banner_urls()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if cardinality(new.banner_urls) = 0 and new.banner_url is not null and new.banner_url <> '' then
      new.banner_urls := array[new.banner_url];
    end if;
  elsif new.banner_urls is not distinct from old.banner_urls
    and new.banner_url is distinct from old.banner_url then
    new.banner_urls := case when new.banner_url is null or new.banner_url = '' then '{}'::text[]
      else array[new.banner_url] || array_remove(array_remove(old.banner_urls, old.banner_url), new.banner_url)
    end;
  end if;
  new.banner_url := new.banner_urls[1];
  return new;
end;
$$;

create trigger sync_store_banner_urls before insert or update of banner_urls, banner_url on public.stores
  for each row execute function public.sync_store_banner_urls();
revoke all on function public.sync_store_banner_urls() from public, anon, authenticated;

create or replace function public.enforce_merchant_appearance_plan()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and new.billing_owner_id is distinct from old.billing_owner_id then
    raise exception 'billing_owner_is_read_only';
  end if;
  if current_user = 'authenticated'
    and row(new.logo_url, new.banner_url, new.banner_urls, new.theme_preset, new.storefront_layout,
      new.storefront_section_order, new.storefront_hidden_sections, new.storefront_style)
      is distinct from row(old.logo_url, old.banner_url, old.banner_urls, old.theme_preset, old.storefront_layout,
      old.storefront_section_order, old.storefront_hidden_sections, old.storefront_style)
    and not public.has_merchant_premium(old.id) then
    raise exception 'premium_plan_required';
  end if;
  return new;
end;
$$;
