-- RLS and gate-policy tests for the Project Brain foundation. Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

-- Fictional test users (no real personal data).
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'producer@example.test', '{"display_name":"Test Producer"}'),
  ('22222222-2222-2222-2222-222222222222', 'writer@example.test',   '{"display_name":"Test Writer"}'),
  ('33333333-3333-3333-3333-333333333333', 'director@example.test', '{"display_name":"Test Director"}'),
  ('44444444-4444-4444-4444-444444444444', 'hod1@example.test',     '{"display_name":"Test HOD 1"}'),
  ('55555555-5555-5555-5555-555555555555', 'hod2@example.test',     '{"display_name":"Test HOD 2"}'),
  ('66666666-6666-6666-6666-666666666666', 'outsider@example.test', '{"display_name":"Test Outsider"}');

select is((select count(*)::int from public.profiles), 6, 'sign-up creates a profile');

-- ---------------------------------------------------------------- anonymous
set local role anon;
select throws_ok('select * from public.projects', '42501', null, 'anon cannot read projects');
select throws_ok($$select public.create_project('X')$$, '42501', null, 'anon cannot create projects');
reset role;

-- ---------------------------------------------------------------- producer creates a project
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select set_config('test.pid', public.create_project('Test Film', 'TST-01')::text, true);

select is((select count(*)::int from public.project_stages where project_id = current_setting('test.pid')::uuid),
  9, 'new project gets nine stages');
select is((select stage_id from public.project_stages where status = 'active'), 'ideate', 'ideate starts active');
select is((select role::text from public.project_members where user_id = auth.uid()), 'producer', 'creator becomes producer');
select is((select count(*)::int from public.gate_requirements where stage_id = 'prep'), 3, 'Gate 6 has three requirements');
select lives_ok($$
  insert into public.project_members (project_id, user_id, role, department) values
    (current_setting('test.pid')::uuid, '22222222-2222-2222-2222-222222222222', 'writer', null),
    (current_setting('test.pid')::uuid, '33333333-3333-3333-3333-333333333333', 'director', null),
    (current_setting('test.pid')::uuid, '44444444-4444-4444-4444-444444444444', 'hod', 'Costume'),
    (current_setting('test.pid')::uuid, '55555555-5555-5555-5555-555555555555', 'hod', 'Camera')
$$, 'producer adds members');
select throws_ok($$insert into public.project_members (project_id, user_id, role, added_by)
  values (current_setting('test.pid')::uuid, '66666666-6666-6666-6666-666666666666', 'crew', '22222222-2222-2222-2222-222222222222')$$,
  '42501', null, 'added_by cannot be forged');

-- ---------------------------------------------------------------- outsider
select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}', true);
select is((select count(*)::int from public.projects), 0, 'outsider sees no projects');
select is((select count(*)::int from public.audit_events), 0, 'outsider sees no audit events');
select is((select count(*)::int from public.profiles), 1, 'outsider sees only their own profile');
select throws_ok($$insert into public.project_members (project_id, user_id, role)
  values (current_setting('test.pid')::uuid, auth.uid(), 'producer')$$, '42501', null, 'outsider cannot join a project');
select throws_ok($$insert into public.brain_records (project_id, kind, title)
  values (current_setting('test.pid')::uuid, 'note', 'x')$$, '42501', null, 'outsider cannot write Brain records');
select lives_ok($$select public.create_project('Other Film')$$, 'outsider can create their own project');

-- ---------------------------------------------------------------- writer (member)
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select is((select count(*)::int from public.projects), 1, 'member sees only their project');
select is((select count(*)::int from public.profiles), 5, 'member sees co-member profiles only');
select throws_ok($$insert into public.project_members (project_id, user_id, role)
  values (current_setting('test.pid')::uuid, auth.uid(), 'producer')$$, '42501', null, 'writer cannot self-assign producer');
select throws_ok($$insert into public.approval_decisions (project_id, stage_id, signer_id, acting_role, decision)
  values (current_setting('test.pid')::uuid, 'ideate', '11111111-1111-1111-1111-111111111111', 'writer', 'approve')$$,
  '42501', null, 'signer_id cannot be forged');
select throws_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.pid')::uuid, 'ideate', 'writer', 'approve')$$,
  'P0001', null, 'cannot sign while the checklist is incomplete');
select throws_ok($$insert into public.audit_events (project_id, actor_kind, action)
  values (current_setting('test.pid')::uuid, 'human', 'forged')$$, '42501', null, 'clients cannot write audit events');
select throws_ok($$update public.audit_events set action = 'forged'$$, '42501', null, 'clients cannot edit audit events');
select lives_ok($$insert into public.brain_records (project_id, stage_id, kind, title, body)
  values (current_setting('test.pid')::uuid, 'ideate', 'idea_card', 'Test idea', '{"logline":"x"}')$$,
  'member adds a Brain record');
select throws_ok($$insert into public.brain_records (project_id, kind, title, origin, agent_key)
  values (current_setting('test.pid')::uuid, 'idea_card', 'Fake AI', 'agent', 'idea_capture')$$,
  '42501', null, 'clients cannot write agent-origin records');

-- ---------------------------------------------------------------- director cannot tick Gate 1
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
update public.gate_checklist_items set done = true where stage_id = 'ideate';
select is((select count(*)::int from public.gate_checklist_items where stage_id = 'ideate' and done), 0,
  'a role outside the gate policy cannot tick its checklist');

-- ---------------------------------------------------------------- producer ticks and Gate 1 passes
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select lives_ok($$update public.gate_checklist_items set done = true
  where project_id = current_setting('test.pid')::uuid and stage_id = 'ideate'$$, 'producer ticks Gate 1');
select is((select count(*)::int from public.gate_checklist_items
  where stage_id = 'ideate' and done_by = auth.uid() and done_at is not null), 3, 'ticks are attributed');
select throws_ok($$update public.gate_checklist_items set done = true
  where project_id = current_setting('test.pid')::uuid and stage_id = 'prep'$$, 'P0001', null, 'a locked gate cannot be ticked');
select throws_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.pid')::uuid, 'ideate', 'director', 'approve')$$, '42501', null, 'cannot sign in a role not held');

select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
insert into public.approval_decisions (project_id, stage_id, acting_role, decision, note)
  values (current_setting('test.pid')::uuid, 'ideate', 'writer', 'reject', 'Not yet');
select is((select status::text from public.project_stages where stage_id = 'ideate'), 'active', 'a rejection does not pass the gate');

select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.pid')::uuid, 'ideate', 'producer', 'approve');
select is((select status::text from public.project_stages where stage_id = 'ideate'), 'passed', 'Gate 1 passes on producer approval');
select is((select status::text from public.project_stages where stage_id = 'develop'), 'active', 'Develop becomes active');
select throws_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.pid')::uuid, 'ideate', 'producer', 'approve')$$, 'P0001', null, 'a passed gate takes no more decisions');
select throws_ok($$delete from public.project_members where user_id = auth.uid()$$, '42501', null, 'the last producer cannot be removed');
reset role;

-- ---------------------------------------------------------------- trusted-record guarantees (even for privileged roles)
select throws_ok($$update public.approval_decisions set decision = 'reject'$$, '42501', null, 'decisions are append-only');
select throws_ok($$delete from public.audit_events$$, '42501', null, 'audit events are append-only');

-- service_role has no DML grant here today; grant it so the trigger guard itself is what's tested.
grant insert on public.approval_decisions to service_role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$truncate public.audit_events$$, '42501', null, 'service role cannot truncate the audit trail');
select throws_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.pid')::uuid, 'develop', 'producer', 'approve')$$, '42501', null,
  'service-role (agent/server) code cannot sign a gate');
reset role;

-- ---------------------------------------------------------------- Gate 6: producer + director + every HOD
-- Fast-forward setup as the table owner, not part of what clients can do.
update public.project_stages set status = 'passed', passed_at = now()
  where project_id = current_setting('test.pid')::uuid and stage_id in ('develop', 'write', 'protect', 'finance');
update public.project_stages set status = 'active', activated_at = now()
  where project_id = current_setting('test.pid')::uuid and stage_id = 'prep';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
update public.gate_checklist_items set done = true where project_id = current_setting('test.pid')::uuid and stage_id = 'prep';
insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.pid')::uuid, 'prep', 'producer', 'approve');

select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select throws_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.pid')::uuid, 'prep', 'writer', 'approve')$$, '42501', null, 'writer is not a Gate 6 signer');

select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.pid')::uuid, 'prep', 'director', 'approve');
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.pid')::uuid, 'prep', 'hod', 'approve');
select is((select status::text from public.project_stages where stage_id = 'prep'), 'active',
  'Gate 6 stays open while one HOD has not signed');

select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.pid')::uuid, 'prep', 'hod', 'approve');
select is((select status::text from public.project_stages where stage_id = 'prep'), 'passed', 'Gate 6 passes once every HOD signs');
select is((select status::text from public.project_stages where stage_id = 'production'), 'active', 'Production becomes active');
select is((select count(*)::int from public.approval_decisions where stage_id = 'prep'), 4, 'four individual Gate 6 signatures recorded');
select is((select count(distinct signer_id)::int from public.approval_decisions where stage_id = 'prep'), 4,
  'each signature is attributed to its signer');
select is((select count(*)::int from public.audit_events where action = 'gate.passed'), 2, 'gate passes are audited');
select is((select count(*)::int from public.audit_events where action = 'gate.decision' and actor_id is null), 0,
  'every decision audit row names a person');

select * from finish();
rollback;
