create function public.valid_store_order_hours(schedule jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  entry jsonb;
begin
  if jsonb_typeof(schedule) <> 'array' then return false; end if;
  if jsonb_array_length(schedule) <> 7 then return false; end if;
  for entry in select value from jsonb_array_elements(schedule) loop
    if entry = 'null'::jsonb then continue; end if;
    if jsonb_typeof(entry) <> 'array' then return false; end if;
    if jsonb_array_length(entry) <> 2 then return false; end if;
    if jsonb_typeof(entry->0) <> 'number' or jsonb_typeof(entry->1) <> 'number'
       or (entry->>0) !~ '^[0-9]{1,4}$' or (entry->>1) !~ '^[0-9]{1,4}$' then
      return false;
    end if;
    if (entry->>0)::integer >= 1440 or (entry->>1)::integer >= 1440 or entry->0 = entry->1 then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

alter table public.stores
  add column order_hours jsonb check (order_hours is null or public.valid_store_order_hours(order_hours));
grant update (order_hours) on public.stores to authenticated;

create function public.enforce_store_order_hours()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  schedule jsonb;
  local_time timestamp := clock_timestamp() at time zone 'Asia/Ho_Chi_Minh';
  weekday integer := extract(dow from local_time)::integer;
  minute integer := extract(hour from local_time)::integer * 60 + extract(minute from local_time)::integer;
  today_hours jsonb;
  previous_hours jsonb;
begin
  select s.order_hours into schedule from public.stores s where s.id = new.store_id;
  if schedule is null then return new; end if;

  today_hours := schedule->weekday;
  previous_hours := schedule->((weekday + 6) % 7);
  if ((today_hours->>0)::integer <= minute
      and ((today_hours->>0)::integer > (today_hours->>1)::integer or minute < (today_hours->>1)::integer))
     or ((previous_hours->>0)::integer > (previous_hours->>1)::integer and minute < (previous_hours->>1)::integer) then
    return new;
  end if;

  raise exception 'store is outside order hours' using errcode = 'P0001';
end;
$$;

create trigger orders_enforce_store_order_hours
  before insert on public.orders
  for each row execute function public.enforce_store_order_hours();
