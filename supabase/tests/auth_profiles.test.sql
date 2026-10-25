-- Phase 1B: profiles for email and Google sign-ups, and new accounts get no project access.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email, raw_user_meta_data) values
  ('e1000000-0000-0000-0000-000000000001', 'email@example.test', '{"display_name": "  Meera Nair  "}'),
  ('e1000000-0000-0000-0000-000000000002', 'google@example.test', '{"full_name": "Arjun Rao", "name": "Arjun", "avatar_url": "https://x.test/a.png"}'),
  ('e1000000-0000-0000-0000-000000000003', 'plain@example.test', '{"name": "Kavi"}'),
  ('e1000000-0000-0000-0000-000000000004', 'none@example.test', '{"display_name": "   "}'),
  ('e1000000-0000-0000-0000-000000000005', 'long@example.test', jsonb_build_object('full_name', repeat('x', 300)));

select is((select display_name from public.profiles where id = 'e1000000-0000-0000-0000-000000000001'), 'Meera Nair', 'email sign-up name is trimmed');
select is((select display_name from public.profiles where id = 'e1000000-0000-0000-0000-000000000002'), 'Arjun Rao', 'Google full_name becomes the display name');
select is((select display_name from public.profiles where id = 'e1000000-0000-0000-0000-000000000003'), 'Kavi', 'falls back to name');
select is((select display_name from public.profiles where id = 'e1000000-0000-0000-0000-000000000004'), null, 'blank name stays null');
select is((select char_length(display_name) from public.profiles where id = 'e1000000-0000-0000-0000-000000000005'), 120, 'long names are cut to 120');

-- signing in again (last_sign_in_at, new identity) updates auth.users; it must not add a profile
update auth.users set last_sign_in_at = now(), raw_user_meta_data = '{"full_name": "Changed"}' where id = 'e1000000-0000-0000-0000-000000000002';
select is((select count(*)::int from public.profiles where id = 'e1000000-0000-0000-0000-000000000002'), 1, 'repeat logins keep one profile');

-- a brand-new account sees no projects and holds no memberships
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.project_members), 0, 'new account has no memberships');
select is((select count(*)::int from public.projects), 0, 'new account sees no projects');

select * from finish();
rollback;
