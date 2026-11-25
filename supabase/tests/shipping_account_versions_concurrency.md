# Shipping account version: two-session PostgreSQL checks

Run these checks only against a disposable local PostgreSQL database with
migrations `202611230001` through `202611230006` applied. Do not point either
session at Supabase Staging or Production. The single-transaction SQL security
test cannot demonstrate that a second backend blocks on a row lock, so these
checks require two independent `psql` sessions.

## One-time disposable fixtures

Create two real stores in the disposable test database, then insert two
`shipping_provider_accounts` rows with unique IDs and the corresponding store
IDs. Both accounts must be disabled shop-scope GHN accounts in `staging`, with
external Shop IDs `970001` and `970002`; leave `credential_ciphertext` null.
Copy the auth user/store fixture inserts at the start of
`shipping_account_versions_security.sql`, change the UUIDs/slugs, and commit
those fixtures in the disposable database. Insert the two parent accounts with
`service_role` as in that SQL test. Record their account/store UUIDs as
`ACCOUNT_A`, `STORE_A`, `ACCOUNT_B`, and `STORE_B`. The RPC uses structurally
valid dummy ciphertext and makes no GHN network calls.

Open two terminals connected to that same disposable database. Define these
psql variables in both sessions, replacing the sample values with fixture UUIDs:

```psql
\set account_a 'actual-account-a-uuid'
\set store_a 'actual-store-a-uuid'
\set account_b 'actual-account-b-uuid'
\set store_b 'actual-store-b-uuid'
```

Use a fresh version UUID for every create attempt.

## Parent update waits for a version insert, then is rejected

**Session 1:**

```sql
begin;
select public.create_shipping_account_version(
  '54000000-0000-4000-8000-000000000101', :'account_a', 'ghn', 'staging', 'shop',
  :'store_a', '970001', 'v1:AA==:AA==:AA==', 'v1'
);
select pg_sleep(8);
commit;
```

While Session 1 sleeps, run in **Session 2**:

```sql
set lock_timeout = '15s';
update public.shipping_provider_accounts
set external_shop_id = '970011'
where id = :'account_a';
```

Expected: Session 2 waits for Session 1's parent `FOR SHARE` lock. After Session
1 commits, the parent identity trigger rejects the update with SQLSTATE `55000`.

## Parent identity update wins first; version creation sees the new identity

Use the still-unversioned `ACCOUNT_B`.

**Session 1:**

```sql
begin;
update public.shipping_provider_accounts
set external_shop_id = '970022'
where id = :'account_b';
select pg_sleep(8);
commit;
```

While Session 1 sleeps, run in **Session 2**:

```sql
set lock_timeout = '15s';
select public.create_shipping_account_version(
  '54000000-0000-4000-8000-000000000102', :'account_b', 'ghn', 'staging', 'shop',
  :'store_b', '970002', 'v1:AA==:AA==:AA==', 'v1'
);
```

Expected: Session 2 waits for the parent lock, then the insert trigger reads the
committed Shop ID `970022` and rejects the stale identity with SQLSTATE `23514`.

## Enable and revoke serialize on the version row

Use the version created on Account A above and mark it verified:

```sql
select public.record_shipping_account_version_check(
  '54000000-0000-4000-8000-000000000101', 'verified'
);
```

Then:

**Session 1:**

```sql
begin;
select public.set_shipping_account_version_enabled(
  '54000000-0000-4000-8000-000000000101', true
);
select pg_sleep(8);
commit;
```

While Session 1 sleeps, run in **Session 2**:

```sql
set lock_timeout = '15s';
select public.revoke_shipping_account_version(
  '54000000-0000-4000-8000-000000000101'
);
```

Expected: revoke waits for the version `FOR UPDATE` lock, then commits with
`enabled=false` and a non-null `revoked_at`. For the reverse ordering, first
create version `54000000-0000-4000-8000-000000000102` using Account B's now
current Shop ID `970022`, then mark it verified:

```sql
select public.create_shipping_account_version(
  '54000000-0000-4000-8000-000000000102', :'account_b', 'ghn', 'staging', 'shop',
  :'store_b', '970022', 'v1:AA==:AA==:AA==', 'v1'
);
select public.record_shipping_account_version_check(
  '54000000-0000-4000-8000-000000000102', 'verified'
);
```

**Session 1:**

```sql
begin;
select public.revoke_shipping_account_version(
  '54000000-0000-4000-8000-000000000102'
);
select pg_sleep(8);
commit;
```

While Session 1 sleeps, run in **Session 2**:

```sql
set lock_timeout = '15s';
select public.set_shipping_account_version_enabled(
  '54000000-0000-4000-8000-000000000102', true
);
```

Expected: Session 2 waits, then receives SQLSTATE `55000` because the version
is revoked.

After each scenario, inspect the final row as the database administrator. Drop
the entire disposable database after the checks; versions are intentionally not
deletable through application SQL.
