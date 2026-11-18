-- SMTP credentials are only accessed by trusted server code using the service role.
create table public.platform_email_settings (
  id boolean primary key default true check (id),
  smtp_host text not null check (length(smtp_host) between 1 and 253),
  smtp_port integer not null check (smtp_port in (465, 587, 2525)),
  smtp_username text not null check (length(smtp_username) between 1 and 254),
  password_ciphertext text not null,
  sender_email text not null check (length(sender_email) between 3 and 254),
  sender_name text not null check (length(sender_name) between 1 and 100),
  updated_at timestamptz not null default now()
);
alter table public.platform_email_settings enable row level security;
revoke all on public.platform_email_settings from public, anon, authenticated;
grant select, insert, update on public.platform_email_settings to service_role;
