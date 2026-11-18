-- Run only on GrowDesk Test after 202611190003; all changes are rolled back.
begin;
select set_config('test.customer_a', gen_random_uuid()::text, true), set_config('test.customer_b', gen_random_uuid()::text, true);
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values (current_setting('test.customer_a')::uuid,'address-a-' || current_setting('test.customer_a') || '@example.invalid',now(),'{"created_by_platform_admin":true}','{}'),
       (current_setting('test.customer_b')::uuid,'address-b-' || current_setting('test.customer_b') || '@example.invalid',now(),'{"created_by_platform_admin":true}','{}');
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.customer_a'), true);
insert into public.customer_addresses(recipient_name,phone,address) values ('Khách A','0900000000','123 Đường kiểm thử') returning set_config('test.address_id', id::text, true);
do $$ begin
  if (select count(*) from public.customer_addresses where id = current_setting('test.address_id')::uuid) <> 1 then raise exception 'Owner cannot read address'; end if;
  if has_column_privilege('authenticated', 'public.customer_addresses', 'user_id', 'INSERT') or has_column_privilege('authenticated', 'public.customer_addresses', 'user_id', 'UPDATE') then raise exception 'Owner ID is writable'; end if;
end $$;
select set_config('request.jwt.claim.sub', current_setting('test.customer_b'), true);
do $$ declare affected integer; begin
  if exists(select 1 from public.customer_addresses where id = current_setting('test.address_id')::uuid) then raise exception 'Address is visible to another customer'; end if;
  update public.customer_addresses set address = 'Địa chỉ bị sửa' where id = current_setting('test.address_id')::uuid;
  get diagnostics affected = row_count; if affected <> 0 then raise exception 'Another customer can edit address'; end if;
  delete from public.customer_addresses where id = current_setting('test.address_id')::uuid;
  get diagnostics affected = row_count; if affected <> 0 then raise exception 'Another customer can delete address'; end if;
end $$;
select set_config('request.jwt.claim.sub', current_setting('test.customer_a'), true);
do $$ declare affected integer; begin
  update public.customer_addresses set address = '456 Đường kiểm thử' where id = current_setting('test.address_id')::uuid;
  get diagnostics affected = row_count; if affected <> 1 then raise exception 'Owner cannot update address'; end if;
  delete from public.customer_addresses where id = current_setting('test.address_id')::uuid;
  get diagnostics affected = row_count; if affected <> 1 then raise exception 'Owner cannot delete address'; end if;
end $$;
rollback;
