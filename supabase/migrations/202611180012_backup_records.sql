-- Manual records only: inserting a row does not run or verify a backup/restore.
create table public.backup_records (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('database', 'images', 'store_files', 'other')),
  result text not null check (result in ('success', 'failed')),
  integrity_result text not null check (integrity_result in ('not_checked', 'passed', 'failed')),
  completed_at timestamptz not null,
  reference text not null check (char_length(trim(reference)) between 1 and 160),
  notes text not null default '' check (char_length(notes) <= 1000),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  check (result <> 'failed' or integrity_result <> 'passed')
);
create index backup_records_recorded_idx on public.backup_records(recorded_at desc, id);
create table public.backup_restore_records (
  id uuid primary key default gen_random_uuid(),
  backup_id uuid not null references public.backup_records(id) on delete restrict,
  target text not null check (target in ('test', 'production', 'other')),
  result text not null check (result in ('success', 'failed')),
  completed_at timestamptz not null,
  notes text not null default '' check (char_length(notes) <= 1000),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now()
);
create index backup_restore_records_recorded_idx on public.backup_restore_records(recorded_at desc, id);
alter table public.backup_records enable row level security;
alter table public.backup_restore_records enable row level security;
revoke all on public.backup_records, public.backup_restore_records from public, anon, authenticated;
grant select, insert on public.backup_records, public.backup_restore_records to authenticated;
create policy backup_records_admin_read on public.backup_records for select to authenticated using ((select public.is_platform_admin()));
create policy backup_records_admin_insert on public.backup_records for insert to authenticated with check ((select public.is_platform_admin()) and recorded_by = (select auth.uid()));
create policy backup_restore_records_admin_read on public.backup_restore_records for select to authenticated using ((select public.is_platform_admin()));
create policy backup_restore_records_admin_insert on public.backup_restore_records for insert to authenticated with check ((select public.is_platform_admin()) and recorded_by = (select auth.uid()) and exists (select 1 from public.backup_records b where b.id = backup_id and b.result = 'success'));
