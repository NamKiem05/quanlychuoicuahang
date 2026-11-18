alter table public.platform_staff_invitations
  add column staff_role_label text check (staff_role_label is null or staff_role_label in (
    'super_admin', 'system_admin', 'support_admin', 'finance_admin',
    'sales_admin', 'technical_admin', 'content_admin'
  ));
