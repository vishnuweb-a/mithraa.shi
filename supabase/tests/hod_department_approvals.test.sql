-- Department-specific HOD approvals on Gate 6 (Phase 1A.1). Run with: supabase test db
-- Scenario A: one person is HOD of three departments and signs each separately.
-- Scenario B: a team splits departments; one member holds two; departments never leak across projects.
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

-- Fictional test users (no real personal data).
insert into auth.users (id, email) values
  ('d0000000-0000-0000-0000-000000000001', 'solo-hod@example.test'),
  ('d1111111-1111-1111-1111-111111111111', 'producer@example.test'),
  ('d2222222-2222-2222-2222-222222222222', 'director@example.test'),
  ('d3333333-3333-3333-3333-333333333333', 'hod-costume@example.test'),
  ('d4444444-4444-4444-4444-444444444444', 'hod-camera-sound@example.test'),
  ('d5555555-5555-5555-5555-555555555555', 'outsider@example.test');

-- ================================================================ Scenario A: one person, three departments
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.solo', public.create_project('Solo HOD Film', 'HOD-1')::text, true);

select lives_ok($$
  insert into public.project_members (project_id, user_id, role, department) values
    (current_setting('test.solo')::uuid, auth.uid(), 'director', 'Second unit'),
    (current_setting('test.solo')::uuid, auth.uid(), 'hod',      'Camera'),
    (current_setting('test.solo')::uuid, auth.uid(), 'hod',      'Sound'),
    (current_setting('test.solo')::uuid, auth.uid(), 'hod',      'Costume')
$$, 'solo: owner is HOD of three departments; a non-HOD role keeps free-form department metadata');
select throws_ok($$insert into public.project_members (project_id, user_id, role)
  values (current_setting('test.solo')::uuid, auth.uid(), 'hod')$$, '23514', null,
  'a HOD membership must name a department');

reset role;
-- Fast-forward to Gate 6 as the table owner, not part of what clients can do.
update public.project_stages set status = 'passed', passed_at = now()
  where project_id = current_setting('test.solo')::uuid and stage_id in ('ideate', 'develop', 'write', 'protect', 'finance');
update public.project_stages set status = 'active', activated_at = now()
  where project_id = current_setting('test.solo')::uuid and stage_id = 'prep';
set local role authenticated;
update public.gate_checklist_items set done = true where project_id = current_setting('test.solo')::uuid and stage_id = 'prep';

select throws_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.solo')::uuid, 'prep', 'hod', 'approve')$$, '23514', null,
  'a HOD decision requires a department');
select throws_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, department, decision)
  values (current_setting('test.solo')::uuid, 'prep', 'hod', 'Art', 'approve')$$, '42501', null,
  'a HOD cannot sign for a department they are not assigned');
select throws_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, department, decision)
  values (current_setting('test.solo')::uuid, 'prep', 'producer', 'Camera', 'approve')$$, '23514', null,
  'a non-HOD decision cannot claim a department');
select throws_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, department, decision)
  values (current_setting('test.solo')::uuid, 'prep', 'director', 'Second unit', 'approve')$$, '23514', null,
  'non-HOD membership metadata does not become a decision department');

select lives_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.solo')::uuid, 'prep', 'producer', 'approve'),
         (current_setting('test.solo')::uuid, 'prep', 'director', 'approve')$$,
  'solo: signs as producer and as a director whose membership has department metadata');
select lives_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, department, decision)
  values (current_setting('test.solo')::uuid, 'prep', 'hod', 'Camera', 'approve')$$, 'solo: signs as Camera HOD');
select is((select status::text from public.project_stages where project_id = current_setting('test.solo')::uuid and stage_id = 'prep'),
  'active', 'solo: one department sign-off does not cover the other two');
select throws_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, department, decision)
  values (current_setting('test.solo')::uuid, 'prep', 'hod', 'Camera', 'approve')$$, '23505', null,
  'a repeated approval in the same department is a duplicate');
select lives_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, department, decision)
  values (current_setting('test.solo')::uuid, 'prep', 'hod', 'Sound', 'reject')$$, 'solo: rejects as Sound HOD');
select lives_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, department, decision)
  values (current_setting('test.solo')::uuid, 'prep', 'hod', 'Sound', 'approve')$$, 'solo: Sound HOD changes reject to approve');
select is((select status::text from public.project_stages where project_id = current_setting('test.solo')::uuid and stage_id = 'prep'),
  'active', 'solo: Gate 6 stays open while Costume has not signed');
select lives_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, department, decision)
  values (current_setting('test.solo')::uuid, 'prep', 'hod', 'Costume', 'approve')$$, 'solo: signs as Costume HOD');
select is((select status::text from public.project_stages where project_id = current_setting('test.solo')::uuid and stage_id = 'prep'),
  'passed', 'solo: Gate 6 passes once every department has signed');
select is((select status::text from public.project_stages where project_id = current_setting('test.solo')::uuid and stage_id = 'production'),
  'active', 'solo: Production opens');
select results_eq($$select signer_id, acting_role::text, department, decision::text from public.approval_decisions
    where project_id = current_setting('test.solo')::uuid and stage_id = 'prep' order by id$$,
  $$values ('d0000000-0000-0000-0000-000000000001'::uuid, 'producer', null::text, 'approve'),
           ('d0000000-0000-0000-0000-000000000001'::uuid, 'director', null, 'approve'),
           ('d0000000-0000-0000-0000-000000000001'::uuid, 'hod', 'Camera', 'approve'),
           ('d0000000-0000-0000-0000-000000000001'::uuid, 'hod', 'Sound', 'reject'),
           ('d0000000-0000-0000-0000-000000000001'::uuid, 'hod', 'Sound', 'approve'),
           ('d0000000-0000-0000-0000-000000000001'::uuid, 'hod', 'Costume', 'approve')$$,
  'solo: each department sign-off is its own record');
select results_eq($$select actor_id, detail ->> 'role', detail ->> 'department', detail ->> 'decision' from public.audit_events
    where project_id = current_setting('test.solo')::uuid and action = 'gate.decision' order by id$$,
  $$values ('d0000000-0000-0000-0000-000000000001'::uuid, 'producer', null::text, 'approve'),
           ('d0000000-0000-0000-0000-000000000001'::uuid, 'director', null, 'approve'),
           ('d0000000-0000-0000-0000-000000000001'::uuid, 'hod', 'Camera', 'approve'),
           ('d0000000-0000-0000-0000-000000000001'::uuid, 'hod', 'Sound', 'reject'),
           ('d0000000-0000-0000-0000-000000000001'::uuid, 'hod', 'Sound', 'approve'),
           ('d0000000-0000-0000-0000-000000000001'::uuid, 'hod', 'Costume', 'approve')$$,
  'solo: audit records signer, acting role and department');
select is((select count(*)::int from public.audit_events
    where project_id = current_setting('test.solo')::uuid and action = 'gate.passed' and target_id = 'prep'), 1,
  'solo: exactly one gate.passed for Gate 6');

-- Regression: an "every director" row must still match a director whose membership has department metadata.
reset role;
insert into public.gate_requirements (project_id, stage_id, roles, signers_required)
  values (current_setting('test.solo')::uuid, 'production', '{director}', null);
set local role authenticated;
update public.gate_checklist_items set done = true where project_id = current_setting('test.solo')::uuid and stage_id = 'production';
insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.solo')::uuid, 'production', 'director', 'approve');
select is((select status::text from public.project_stages where project_id = current_setting('test.solo')::uuid and stage_id = 'production'),
  'passed', 'solo: non-HOD department metadata does not block an "every holder" requirement');

-- ================================================================ Scenario B: departments split across a team
select set_config('request.jwt.claims', '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select set_config('test.team', public.create_project('Team HOD Film', 'HOD-2')::text, true);
select lives_ok($$
  insert into public.project_members (project_id, user_id, role, department) values
    (current_setting('test.team')::uuid, 'd2222222-2222-2222-2222-222222222222', 'director', null),
    (current_setting('test.team')::uuid, 'd3333333-3333-3333-3333-333333333333', 'hod',      'Costume'),
    (current_setting('test.team')::uuid, 'd4444444-4444-4444-4444-444444444444', 'hod',      'Camera'),
    (current_setting('test.team')::uuid, 'd4444444-4444-4444-4444-444444444444', 'hod',      'Sound')
$$, 'team: producer assigns Costume to one HOD and Camera + Sound to another');

-- The Costume HOD is Camera HOD on someone else's film.
select set_config('request.jwt.claims', '{"sub":"d5555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
select set_config('test.other', public.create_project('Other Film', 'HOD-3')::text, true);
insert into public.project_members (project_id, user_id, role, department) values
  (current_setting('test.other')::uuid, 'd3333333-3333-3333-3333-333333333333', 'hod', 'Camera'),
  (current_setting('test.other')::uuid, auth.uid(),                              'hod', 'Camera');

reset role;
update public.project_stages set status = 'passed', passed_at = now()
  where project_id = current_setting('test.team')::uuid and stage_id in ('ideate', 'develop', 'write', 'protect', 'finance');
update public.project_stages set status = 'active', activated_at = now()
  where project_id = current_setting('test.team')::uuid and stage_id = 'prep';
-- Explicit distinct-person rule on Gate 7: two different HODs, whatever their departments.
insert into public.gate_requirements (project_id, stage_id, roles, signers_required)
  values (current_setting('test.team')::uuid, 'production', '{hod}', 2);
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
update public.gate_checklist_items set done = true where project_id = current_setting('test.team')::uuid and stage_id = 'prep';
insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.team')::uuid, 'prep', 'producer', 'approve');

select set_config('request.jwt.claims', '{"sub":"d3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select throws_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, department, decision)
  values (current_setting('test.team')::uuid, 'prep', 'hod', 'Camera', 'approve')$$, '42501', null,
  'a department held on another project does not count here');

select set_config('request.jwt.claims', '{"sub":"d5555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
select throws_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, department, decision)
  values (current_setting('test.team')::uuid, 'prep', 'hod', 'Camera', 'approve')$$, '42501', null,
  'an outsider cannot sign another project''s gate in a department name they hold elsewhere');

select set_config('request.jwt.claims', '{"sub":"d4444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
select lives_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, department, decision)
  values (current_setting('test.team')::uuid, 'prep', 'hod', 'Camera', 'approve'),
         (current_setting('test.team')::uuid, 'prep', 'hod', 'Sound', 'approve')$$,
  'team: one member signs both of their departments');
select throws_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, department, decision)
  values (current_setting('test.team')::uuid, 'prep', 'hod', 'Costume', 'approve')$$, '42501', null,
  'team: a HOD cannot sign another member''s department');

select set_config('request.jwt.claims', '{"sub":"d2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.team')::uuid, 'prep', 'director', 'approve');
select is((select status::text from public.project_stages where project_id = current_setting('test.team')::uuid and stage_id = 'prep'),
  'active', 'team: Gate 6 stays open while the Costume HOD has not signed');

select set_config('request.jwt.claims', '{"sub":"d3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
insert into public.approval_decisions (project_id, stage_id, acting_role, department, decision)
  values (current_setting('test.team')::uuid, 'prep', 'hod', 'Costume', 'approve');
select is((select status::text from public.project_stages where project_id = current_setting('test.team')::uuid and stage_id = 'prep'),
  'passed', 'team: Gate 6 passes after producer, director and all three departments');
select is((select count(*)::int from public.audit_events
    where project_id = current_setting('test.team')::uuid and action = 'gate.passed' and target_id = 'prep'), 1,
  'team: exactly one gate.passed for Gate 6');
select results_eq($$select actor_id, detail ->> 'role', detail ->> 'department' from public.audit_events
    where project_id = current_setting('test.team')::uuid and action = 'gate.decision' order by id$$,
  $$values ('d1111111-1111-1111-1111-111111111111'::uuid, 'producer', null::text),
           ('d4444444-4444-4444-4444-444444444444'::uuid, 'hod', 'Camera'),
           ('d4444444-4444-4444-4444-444444444444'::uuid, 'hod', 'Sound'),
           ('d2222222-2222-2222-2222-222222222222'::uuid, 'director', null),
           ('d3333333-3333-3333-3333-333333333333'::uuid, 'hod', 'Costume')$$,
  'team: audit names the real signer, role and department');

-- Gate 7: "two HODs" counts people, not departments.
select set_config('request.jwt.claims', '{"sub":"d2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
update public.gate_checklist_items set done = true where project_id = current_setting('test.team')::uuid and stage_id = 'production';
insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.team')::uuid, 'production', 'director', 'approve');
select set_config('request.jwt.claims', '{"sub":"d4444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
insert into public.approval_decisions (project_id, stage_id, acting_role, department, decision)
  values (current_setting('test.team')::uuid, 'production', 'hod', 'Camera', 'approve'),
         (current_setting('test.team')::uuid, 'production', 'hod', 'Sound', 'approve');
select is((select status::text from public.project_stages where project_id = current_setting('test.team')::uuid and stage_id = 'production'),
  'active', 'team: two departments from one person do not meet a two-person rule');
select set_config('request.jwt.claims', '{"sub":"d3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
insert into public.approval_decisions (project_id, stage_id, acting_role, department, decision)
  values (current_setting('test.team')::uuid, 'production', 'hod', 'Costume', 'approve');
select is((select status::text from public.project_stages where project_id = current_setting('test.team')::uuid and stage_id = 'production'),
  'passed', 'team: a second, different HOD meets the two-person rule');

-- An approval stops counting once the signer loses that department (gate_satisfied is not client-callable).
reset role;
select is(private.gate_satisfied(current_setting('test.team')::uuid, 'prep'), true, 'team: Gate 6 policy is met');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
delete from public.project_members
  where project_id = current_setting('test.team')::uuid and user_id = 'd4444444-4444-4444-4444-444444444444' and department = 'Sound';
insert into public.project_members (project_id, user_id, role, department)
  values (current_setting('test.team')::uuid, 'd3333333-3333-3333-3333-333333333333', 'hod', 'Sound');
reset role;
select is(private.gate_satisfied(current_setting('test.team')::uuid, 'prep'), false,
  'team: a reassigned department needs its new HOD''s sign-off');
-- The Costume HOD (now also Sound) loses Costume: their Costume approval no longer counts toward Gate 7's two HODs.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
delete from public.project_members
  where project_id = current_setting('test.team')::uuid and user_id = 'd3333333-3333-3333-3333-333333333333' and department = 'Costume';
reset role;
select is(private.gate_satisfied(current_setting('test.team')::uuid, 'production'), false,
  'team: an approval in a department the signer no longer holds does not count toward a numeric rule');

-- Isolation and agents.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d5555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
select is((select count(*)::int from public.approval_decisions where project_id = current_setting('test.team')::uuid), 0,
  'an outsider sees none of the team''s department sign-offs');
reset role;
grant insert on public.approval_decisions to service_role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, department, decision)
  values (current_setting('test.team')::uuid, 'post', 'hod', 'Camera', 'approve')$$, '42501', null,
  'service-role (agent/server) code cannot sign as a HOD');
reset role;

select * from finish();
rollback;
