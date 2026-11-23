begin;

-- Restrict direct service_role privileges to the minimum
-- required for shipping account management.
revoke all privileges on table
  public.shipping_providers,
  public.shipping_provider_accounts,
  public.shipping_account_checks
from service_role;

grant select, insert, update on table
  public.shipping_providers,
  public.shipping_provider_accounts,
  public.shipping_account_checks
to service_role;

commit;