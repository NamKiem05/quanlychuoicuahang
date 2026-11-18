-- Only platform admins may assign or change the industry of an existing store.
create function public.admin_set_store_business_category(target_store uuid, target_category uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.is_platform_admin() is not true then raise exception 'not authorized' using errcode = '42501'; end if;
  if target_category is null or not exists(select 1 from public.business_categories where id = target_category) then raise exception 'invalid category' using errcode = '22023'; end if;
  update public.stores set business_category_id = target_category where id = target_store;
  if not found then raise exception 'store not found' using errcode = 'P0002'; end if;
end; $$;
revoke all on function public.admin_set_store_business_category(uuid,uuid) from public, anon, authenticated;
grant execute on function public.admin_set_store_business_category(uuid,uuid) to authenticated;
