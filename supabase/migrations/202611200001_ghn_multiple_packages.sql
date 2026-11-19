begin;

alter table public.store_ghn_packaging
  add column id uuid not null default gen_random_uuid(),
  add column name text not null default 'Bao bì hiện có'
    check (char_length(trim(name)) between 1 and 80),
  drop constraint store_ghn_packaging_pkey,
  add primary key (id);

create index store_ghn_packaging_store_idx on public.store_ghn_packaging (store_id);

commit;
