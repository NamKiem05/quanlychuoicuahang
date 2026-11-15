-- Publish new order inserts so an authenticated store dashboard can receive them.
-- Row Level Security still limits each subscriber to stores they can read.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'orders'
    ) then
    execute 'alter publication supabase_realtime add table public.orders';
  end if;
end;
$$;
