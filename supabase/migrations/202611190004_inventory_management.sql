-- Store-scoped inventory history, including existing order and product stock updates.
create table public.inventory_events (
  id bigint generated always as identity primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null,
  variant_id uuid,
  product_name text not null,
  variant_attributes jsonb,
  sku text,
  old_stock integer,
  new_stock integer,
  actor_id uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index inventory_events_store_created_idx on public.inventory_events(store_id, created_at desc, id desc);
alter table public.inventory_events enable row level security;
revoke all on public.inventory_events from public, anon, authenticated;
grant select on public.inventory_events to authenticated;
create policy inventory_events_store_read on public.inventory_events for select to authenticated using (public.has_store_role(store_id));

create function public.record_inventory_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare previous integer; product_name text; product_variant uuid; item_product uuid; attrs jsonb; item_sku text;
begin
  if tg_op = 'UPDATE' and old.stock_quantity is not distinct from new.stock_quantity then return new; end if;
  if tg_op = 'UPDATE' then previous := old.stock_quantity; else previous := null; end if;
  if tg_table_name = 'products' then
    if tg_op = 'INSERT' and new.stock_quantity is null then return new; end if;
    product_name := new.name; item_product := new.id;
  else
    select p.name into product_name from public.products p where p.id = new.product_id and p.store_id = new.store_id;
    product_variant := new.id; item_product := new.product_id; attrs := new.attributes; item_sku := new.sku;
  end if;
  insert into public.inventory_events(store_id,product_id,variant_id,product_name,variant_attributes,sku,old_stock,new_stock,actor_id,note)
  values(new.store_id,item_product,product_variant,coalesce(product_name,'Sản phẩm'),attrs,item_sku,previous,new.stock_quantity,auth.uid(),nullif(current_setting('growdesk.inventory_note',true),''));
  return new;
end $$;
revoke all on function public.record_inventory_change() from public, anon, authenticated;
create trigger products_inventory_events after insert or update of stock_quantity on public.products for each row execute function public.record_inventory_change();
create trigger variants_inventory_events after insert or update of stock_quantity on public.product_variant_drafts for each row execute function public.record_inventory_change();

-- Compare the displayed stock under row lock to avoid overwriting concurrent orders.
create function public.adjust_inventory(target_store uuid, target_product uuid, target_variant uuid, expected_stock integer, new_stock integer, reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare current_stock integer; has_variants boolean;
begin
  if auth.uid() is null or not public.has_store_role(target_store) then raise exception 'not authorized' using errcode='42501'; end if;
  if new_stock is null or new_stock < 0 or length(trim(coalesce(reason,''))) not between 1 and 250 then raise exception 'invalid adjustment' using errcode='22023'; end if;
  if target_variant is not null then
    select v.stock_quantity into current_stock from public.product_variant_drafts v where v.id=target_variant and v.product_id=target_product and v.store_id=target_store for update;
  else
    select p.stock_quantity,p.variants_enabled into current_stock,has_variants from public.products p where p.id=target_product and p.store_id=target_store for update;
    if has_variants then raise exception 'adjust variant stock instead' using errcode='22023'; end if;
  end if;
  if not found then raise exception 'stock item not found' using errcode='P0002'; end if;
  if current_stock is distinct from expected_stock then raise exception 'stock changed' using errcode='40001'; end if;
  if current_stock is not distinct from new_stock then raise exception 'stock unchanged' using errcode='22023'; end if;
  perform set_config('growdesk.inventory_note',trim(reason),true);
  if target_variant is not null then update public.product_variant_drafts set stock_quantity=new_stock where id=target_variant and product_id=target_product and store_id=target_store;
  else update public.products set stock_quantity=new_stock where id=target_product and store_id=target_store; end if;
  perform set_config('growdesk.inventory_note','',true);
end $$;
revoke all on function public.adjust_inventory(uuid,uuid,uuid,integer,integer,text) from public, anon;
grant execute on function public.adjust_inventory(uuid,uuid,uuid,integer,integer,text) to authenticated;
