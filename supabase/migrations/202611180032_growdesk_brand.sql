-- Rename the existing default without overwriting a custom platform name.
alter table public.platform_general_settings alter column platform_name set default 'GrowDesk';
update public.platform_general_settings set platform_name = 'GrowDesk', updated_at = now()
where id = true and lower(trim(platform_name)) = 'kingweb';
update public.platform_role_catalog set responsibilities = replace(responsibilities, 'KingWeb', 'GrowDesk')
where code = 'super_admin';
