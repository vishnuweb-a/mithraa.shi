-- Phase 1B: sign-in. Profiles for Google accounts get a name too.
--
-- Email sign-up sends display_name; Google sends full_name / name. Still display-only:
-- user metadata is user-editable and never used for authorization. The trigger fires
-- once per auth.users insert, so repeated logins and linked identities never add a profile.

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(nullif(btrim(coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    )), ''), 120)
  );
  return new;
end;
$$;
