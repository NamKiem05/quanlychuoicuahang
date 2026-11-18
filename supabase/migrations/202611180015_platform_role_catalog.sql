-- Catalog only. It does not grant roles or change existing admin permissions.
create table public.platform_role_catalog (
  code text primary key check (code ~ '^[a-z]+(_[a-z]+)*$'),
  name text not null,
  display_name text not null,
  responsibilities text not null,
  sort_order integer not null
);
alter table public.platform_role_catalog enable row level security;
revoke all on public.platform_role_catalog from public, anon, authenticated;
grant select on public.platform_role_catalog to authenticated;
create policy platform_role_catalog_admin_read on public.platform_role_catalog for select to authenticated using ((select public.is_platform_admin()));
insert into public.platform_role_catalog(code, name, display_name, responsibilities, sort_order) values
  ('super_admin', 'Super Admin', 'Quản trị viên cấp cao', 'Toàn quyền quản trị KingWeb', 1),
  ('system_admin', 'System Admin', 'Quản trị hệ thống', 'Quản lý vận hành và cấu hình hệ thống', 2),
  ('support_admin', 'Support Admin', 'Nhân viên hỗ trợ', 'Tiếp nhận và xử lý yêu cầu hỗ trợ', 3),
  ('finance_admin', 'Finance Admin', 'Nhân viên tài chính', 'Quản lý giao dịch, thanh toán, hoàn tiền', 4),
  ('sales_admin', 'Sales Admin', 'Nhân viên kinh doanh', 'Quản lý khách hàng và gói dịch vụ', 5),
  ('technical_admin', 'Technical Admin', 'Nhân viên kỹ thuật', 'Theo dõi lỗi, máy chủ và tích hợp', 6),
  ('content_admin', 'Content Admin', 'Nhân viên nội dung', 'Quản lý nội dung và thông báo', 7);
