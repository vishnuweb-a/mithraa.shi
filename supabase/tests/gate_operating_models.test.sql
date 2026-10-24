-- Solo and collaborative operating models for gates. Run with: supabase test db
-- Scenario A: one person holds every role and takes a film through all nine gates without fast-forwarding.
-- Scenario B: a team splits the roles; only authorised people sign; acting user and role are recorded.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

-- Fictional test users (no real personal data).
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'solo@example.test'),
  ('b1111111-1111-1111-1111-111111111111', 'owner@example.test'),
  ('b2222222-2222-2222-2222-222222222222', 'director@example.test'),
  ('b3333333-3333-3333-3333-333333333333', 'hod-costume@example.test'),
  ('b4444444-4444-4444-4444-444444444444', 'writer@example.test');

-- ================================================================ Scenario A: solo filmmaker
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
select set_config('test.solo', public.create_project('Solo Film', 'SOLO-1')::text, true);

select lives_ok($$
  insert into public.project_members (project_id, user_id, role, department) values
    (current_setting('test.solo')::uuid, auth.uid(), 'writer',   null),
    (current_setting('test.solo')::uuid, auth.uid(), 'director', null),
    (current_setting('test.solo')::uuid, auth.uid(), 'investor', null),
    (current_setting('test.solo')::uuid, auth.uid(), 'hod',      'All departments'),
    (current_setting('test.solo')::uuid, auth.uid(), 'client',   null)
$$, 'solo: owner assigns every gate role to themselves');
select is((select count(*)::int from public.project_members where project_id = current_setting('test.solo')::uuid), 6,
  'solo: one person holds six roles');
select is((select count(distinct user_id)::int from public.project_members where project_id = current_setting('test.solo')::uuid), 1,
  'solo: the team is a single account');

-- Each gate: tick the checklist, then sign once in every role the policy needs, in one statement.
create temporary table solo_gates (stage_id text, roles text[]) on commit drop;
insert into solo_gates values
  ('ideate',     '{producer}'),
  ('develop',    '{writer,director,producer}'),
  ('write',      '{director,producer}'),
  ('protect',    '{writer,producer}'),
  ('finance',    '{producer,investor}'),
  ('prep',       '{producer,director,hod}'),
  ('production', '{director}'),
  ('post',       '{director,client}'),
  ('release',    '{producer}');
grant select on solo_gates to authenticated;

update public.gate_checklist_items set done = true where project_id = current_setting('test.solo')::uuid and stage_id = 'ideate';
insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  select current_setting('test.solo')::uuid, 'ideate', unnest(roles)::public.project_role, 'approve' from solo_gates where stage_id = 'ideate';
select is((select status::text from public.project_stages where project_id = current_setting('test.solo')::uuid and stage_id = 'ideate'),
  'passed', 'solo: Gate 1 passes');

update public.gate_checklist_items set done = true where project_id = current_setting('test.solo')::uuid and stage_id = 'develop';
insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  select current_setting('test.solo')::uuid, 'develop', unnest(roles)::public.project_role, 'approve' from solo_gates where stage_id = 'develop';
update public.gate_checklist_items set done = true where project_id = current_setting('test.solo')::uuid and stage_id = 'write';
insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  select current_setting('test.solo')::uuid, 'write', unnest(roles)::public.project_role, 'approve' from solo_gates where stage_id = 'write';
update public.gate_checklist_items set done = true where project_id = current_setting('test.solo')::uuid and stage_id = 'protect';
insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  select current_setting('test.solo')::uuid, 'protect', unnest(roles)::public.project_role, 'approve' from solo_gates where stage_id = 'protect';
update public.gate_checklist_items set done = true where project_id = current_setting('test.solo')::uuid and stage_id = 'finance';
insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  select current_setting('test.solo')::uuid, 'finance', unnest(roles)::public.project_role, 'approve' from solo_gates where stage_id = 'finance';
select is((select status::text from public.project_stages where project_id = current_setting('test.solo')::uuid and stage_id = 'prep'),
  'active', 'solo: Gates 2-5 pass and Pre-production opens');

-- Gate 6 one role at a time, to show it stays open until the last capacity signs.
update public.gate_checklist_items set done = true where project_id = current_setting('test.solo')::uuid and stage_id = 'prep';
insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.solo')::uuid, 'prep', 'producer', 'approve'),
         (current_setting('test.solo')::uuid, 'prep', 'director', 'approve');
select is((select status::text from public.project_stages where project_id = current_setting('test.solo')::uuid and stage_id = 'prep'),
  'active', 'solo: Gate 6 stays open until the HOD capacity signs');
select throws_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.solo')::uuid, 'prep', 'producer', 'approve')$$, '23505', null,
  'solo: a second producer approval on the same gate is a duplicate');
select throws_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, department, decision)
  values (current_setting('test.solo')::uuid, 'prep', 'hod', 'All departments', 'approve'),
         (current_setting('test.solo')::uuid, 'prep', 'hod', 'All departments', 'approve')$$, '23505', null,
  'solo: the same role twice in one statement is a duplicate');
select lives_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, department, decision)
  values (current_setting('test.solo')::uuid, 'prep', 'hod', 'All departments', 'approve')$$, 'solo: signs Gate 6 as HOD');
select is((select status::text from public.project_stages where project_id = current_setting('test.solo')::uuid and stage_id = 'prep'),
  'passed', 'solo: Gate 6 passes as producer, director and HOD');

update public.gate_checklist_items set done = true where project_id = current_setting('test.solo')::uuid and stage_id = 'production';
insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  select current_setting('test.solo')::uuid, 'production', unnest(roles)::public.project_role, 'approve' from solo_gates where stage_id = 'production';
update public.gate_checklist_items set done = true where project_id = current_setting('test.solo')::uuid and stage_id = 'post';
insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  select current_setting('test.solo')::uuid, 'post', unnest(roles)::public.project_role, 'approve' from solo_gates where stage_id = 'post';
update public.gate_checklist_items set done = true where project_id = current_setting('test.solo')::uuid and stage_id = 'release';
insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  select current_setting('test.solo')::uuid, 'release', unnest(roles)::public.project_role, 'approve' from solo_gates where stage_id = 'release';

select is((select count(*)::int from public.project_stages where project_id = current_setting('test.solo')::uuid and status = 'passed'),
  9, 'solo: all nine stages passed by one person');
select is((select count(*)::int from public.approval_decisions where project_id = current_setting('test.solo')::uuid), 17,
  'solo: seventeen individual role-specific signatures');
select is((select count(distinct signer_id)::int from public.approval_decisions where project_id = current_setting('test.solo')::uuid), 1,
  'solo: every signature carries the same authenticated user id');
select is((select count(*)::int from public.approval_decisions
  where project_id = current_setting('test.solo')::uuid and stage_id = 'prep'), 3, 'solo: Gate 6 has three separate records');
select is((select count(*)::int from public.audit_events where project_id = current_setting('test.solo')::uuid and action = 'gate.passed'), 9,
  'solo: exactly one gate.passed per gate, even for multi-role inserts');
select results_eq($$select distinct actor_id, detail ->> 'role' from public.audit_events
    where project_id = current_setting('test.solo')::uuid and action = 'gate.decision' order by 2$$,
  $$values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'client'), ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'director'),
           ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'hod'), ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'investor'),
           ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'producer'), ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'writer')$$,
  'solo: audit names the same person acting in each capacity');

-- ================================================================ Scenario B: collaborative team
select set_config('request.jwt.claims', '{"sub":"b1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select set_config('test.team', public.create_project('Team Film', 'TEAM-1')::text, true);
select lives_ok($$
  insert into public.project_members (project_id, user_id, role, department) values
    (current_setting('test.team')::uuid, 'b2222222-2222-2222-2222-222222222222', 'director', null),
    (current_setting('test.team')::uuid, 'b3333333-3333-3333-3333-333333333333', 'hod',      'Costume'),
    (current_setting('test.team')::uuid, 'b4444444-4444-4444-4444-444444444444', 'writer',   null),
    (current_setting('test.team')::uuid, auth.uid(),                              'hod',      'Sound'),
    (current_setting('test.team')::uuid, auth.uid(),                              'director', null)
$$, 'team: owner assigns roles to members and two extra roles to themselves');

select set_config('request.jwt.claims', '{"sub":"b3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select throws_ok($$insert into public.project_members (project_id, user_id, role)
  values (current_setting('test.team')::uuid, auth.uid(), 'director')$$, '42501', null, 'team: a HOD cannot self-assign director');
reset role;

-- Fast-forward to Gate 6 as the table owner, not part of what clients can do.
update public.project_stages set status = 'passed', passed_at = now()
  where project_id = current_setting('test.team')::uuid and stage_id in ('ideate', 'develop', 'write', 'protect', 'finance');
update public.project_stages set status = 'active', activated_at = now()
  where project_id = current_setting('test.team')::uuid and stage_id = 'prep';
-- Explicitly configured distinct-person rule on Gate 7: two different directors must approve.
insert into public.gate_requirements (project_id, stage_id, roles, signers_required)
  values (current_setting('test.team')::uuid, 'production', '{director}', 2);
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"b1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
update public.gate_checklist_items set done = true where project_id = current_setting('test.team')::uuid and stage_id = 'prep';
select lives_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, department, decision)
  values (current_setting('test.team')::uuid, 'prep', 'producer', null, 'approve'),
         (current_setting('test.team')::uuid, 'prep', 'hod', 'Sound', 'approve')$$, 'team: owner signs as producer and as Sound HOD');

select set_config('request.jwt.claims', '{"sub":"b4444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
select throws_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.team')::uuid, 'prep', 'writer', 'approve')$$, '42501', null, 'team: writer is not a Gate 6 signer');
select throws_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.team')::uuid, 'prep', 'director', 'approve')$$, '42501', null, 'team: writer cannot sign as director');

select set_config('request.jwt.claims', '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.team')::uuid, 'prep', 'director', 'approve');
select is((select status::text from public.project_stages where project_id = current_setting('test.team')::uuid and stage_id = 'prep'),
  'active', 'team: Gate 6 stays open while the Costume HOD has not signed');

select set_config('request.jwt.claims', '{"sub":"b3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select throws_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.team')::uuid, 'prep', 'producer', 'approve')$$, '42501', null, 'team: HOD cannot sign as producer');
insert into public.approval_decisions (project_id, stage_id, acting_role, department, decision)
  values (current_setting('test.team')::uuid, 'prep', 'hod', 'Costume', 'approve');
select is((select status::text from public.project_stages where project_id = current_setting('test.team')::uuid and stage_id = 'prep'),
  'passed', 'team: Gate 6 passes once every configured requirement is met');
select results_eq($$select signer_id, acting_role::text from public.approval_decisions
    where project_id = current_setting('test.team')::uuid and stage_id = 'prep' order by id$$,
  $$values ('b1111111-1111-1111-1111-111111111111'::uuid, 'producer'), ('b1111111-1111-1111-1111-111111111111'::uuid, 'hod'),
           ('b2222222-2222-2222-2222-222222222222'::uuid, 'director'), ('b3333333-3333-3333-3333-333333333333'::uuid, 'hod')$$,
  'team: each Gate 6 record keeps its true signer and acting role');
select results_eq($$select actor_id, detail ->> 'role' from public.audit_events
    where project_id = current_setting('test.team')::uuid and action = 'gate.decision' order by id$$,
  $$values ('b1111111-1111-1111-1111-111111111111'::uuid, 'producer'), ('b1111111-1111-1111-1111-111111111111'::uuid, 'hod'),
           ('b2222222-2222-2222-2222-222222222222'::uuid, 'director'), ('b3333333-3333-3333-3333-333333333333'::uuid, 'hod')$$,
  'team: audit trail matches the signatures');

-- Gate 7 with the explicit two-distinct-directors rule.
select set_config('request.jwt.claims', '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
update public.gate_checklist_items set done = true where project_id = current_setting('test.team')::uuid and stage_id = 'production';
insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.team')::uuid, 'production', 'director', 'approve');
select is((select status::text from public.project_stages where project_id = current_setting('test.team')::uuid and stage_id = 'production'),
  'active', 'team: a configured two-person rule is not met by one director');
select throws_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.team')::uuid, 'production', 'director', 'approve')$$, '23505', null,
  'team: the same director cannot approve twice to fake a second signer');
select set_config('request.jwt.claims', '{"sub":"b1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.team')::uuid, 'production', 'director', 'approve');
select is((select status::text from public.project_stages where project_id = current_setting('test.team')::uuid and stage_id = 'production'),
  'passed', 'team: a second, different director meets the configured two-person rule');

-- A reject followed by an approve in the same role is a changed mind, not a duplicate.
select set_config('request.jwt.claims', '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
update public.gate_checklist_items set done = true where project_id = current_setting('test.team')::uuid and stage_id = 'post';
insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.team')::uuid, 'post', 'director', 'reject');
select lives_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.team')::uuid, 'post', 'director', 'approve')$$, 'team: a signer can change their mind');
select is((select status::text from public.project_stages where project_id = current_setting('test.team')::uuid and stage_id = 'post'),
  'active', 'team: Gate 8 still needs the client/buyer');

-- Agents still cannot sign, in either model.
reset role;
grant insert on public.approval_decisions to service_role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.team')::uuid, 'post', 'client', 'approve')$$, '42501', null,
  'service-role (agent/server) code cannot sign a gate');
reset role;

select * from finish();
rollback;
