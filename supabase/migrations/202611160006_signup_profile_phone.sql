create or replace function public.create_profile_for_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  signup_phone text := new.raw_user_meta_data ->> 'phone';
begin
  insert into public.profiles (id, display_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1)),
    case when signup_phone ~ '^[+]?[0-9]{8,15}$' then signup_phone end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Recover phone numbers submitted before this migration without overwriting profile edits.
update public.profiles p
set phone = u.raw_user_meta_data ->> 'phone'
from auth.users u
where p.id = u.id
  and p.phone is null
  and (u.raw_user_meta_data ->> 'phone') ~ '^[+]?[0-9]{8,15}$';
