-- Self-financing (Gate 5) and self-distribution (Gate 8). Run with: supabase test db
-- 1. Solo, self-financed, self-distributed: all nine gates, no investor or buyer roles.
-- 2. Team, external financing, self-distribution.
-- 3. Solo, self-financed, external distribution to a real buyer.
-- External financing and external delivery are also covered in gate_operating_models.test.sql.
begin;
create extension if not exists pgtap with schema extensions;
select plan(82);

-- Fictional test users (no real personal data).
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'solo@example.test'),
  ('d2000000-0000-0000-0000-000000000002', 'producer-1@example.test'),
  ('d3000000-0000-0000-0000-000000000003', 'producer-2@example.test'),
  ('d4000000-0000-0000-0000-000000000004', 'director@example.test'),
  ('d5000000-0000-0000-0000-000000000005', 'investor@example.test'),
  ('d6000000-0000-0000-0000-000000000006', 'buyer@example.test'),
  ('d7000000-0000-0000-0000-000000000007', 'outsider@example.test');
insert into auth.users (id, is_anonymous) values ('d8000000-0000-0000-0000-000000000008', true);

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;
-- The token Supabase issues to an anonymous sign-in.
create function pg_temp.as_guest(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'is_anonymous', true)::text, true);
$$;
-- Owner-only fast-forward: passes every stage before p_stage and opens it. Not something clients can do.
create function pg_temp.open_gate(p_project uuid, p_stage text) returns void language sql as $$
  update public.project_stages s set status = 'passed', passed_at = now()
  from public.stages st where st.id = s.stage_id and s.project_id = p_project
    and st.position < (select position from public.stages where id = p_stage);
  update public.project_stages set status = 'active', activated_at = now()
  where project_id = p_project and stage_id = p_stage;
$$;

-- ================================================================ 1. Solo, self / self
set local role authenticated;
select pg_temp.as_user('d1000000-0000-0000-0000-000000000001');
select set_config('test.solo', public.create_project('Solo Self Release', 'SELF-1')::text, true);

select results_eq($$select financing_mode::text, distribution_mode::text from public.projects where id = current_setting('test.solo')::uuid$$,
  $$values ('external', 'external')$$, 'new projects default to external financing and distribution');
select ok(exists (select 1 from public.gate_requirements where project_id = current_setting('test.solo')::uuid
  and stage_id = 'finance' and roles = '{investor}' and signers_required is null), 'external Gate 5 needs every investor');
select ok(exists (select 1 from public.gate_requirements where project_id = current_setting('test.solo')::uuid
  and stage_id = 'post' and roles = '{client}'), 'external Gate 8 needs a client/buyer');
select throws_ok($$update public.projects set financing_mode = 'self' where id = current_setting('test.solo')::uuid$$,
  '42501', null, 'a producer cannot set a mode by updating the project row');
select throws_ok($$update public.gate_requirements set roles = '{producer}' where project_id = current_setting('test.solo')::uuid$$,
  '42501', null, 'clients cannot edit gate policy');
select throws_ok($$select public.set_project_mode(current_setting('test.solo')::uuid, 'budget', 'self')$$,
  '22023', null, 'unknown settings are rejected');

insert into public.project_members (project_id, user_id, role, department) values
  (current_setting('test.solo')::uuid, auth.uid(), 'writer',   null),
  (current_setting('test.solo')::uuid, auth.uid(), 'director', null),
  (current_setting('test.solo')::uuid, auth.uid(), 'hod',      'All departments');

select lives_ok($$select public.set_project_mode(current_setting('test.solo')::uuid, 'financing', 'self')$$,
  'producer declares self-financing');
select lives_ok($$select public.set_project_mode(current_setting('test.solo')::uuid, 'distribution', 'self')$$,
  'producer declares self-distribution');
select results_eq($$select roles::text, signers_required from public.gate_requirements
    where project_id = current_setting('test.solo')::uuid and stage_id = 'finance'$$,
  $$values ('{producer}', 1::smallint)$$, 'self Gate 5 policy: producer only, no investor row');
select results_eq($$select roles::text, signers_required from public.gate_requirements
    where project_id = current_setting('test.solo')::uuid and stage_id = 'post' order by roles::text$$,
  $$values ('{director}', 1::smallint), ('{producer}', 1::smallint)$$, 'self Gate 8 policy: director final cut + producer, no client row');
select results_eq($$select label from public.gate_checklist_items
    where project_id = current_setting('test.solo')::uuid and stage_id = 'finance' order by position$$,
  $$values ('Budget approved and baselined'), ('Self-financing plan recorded against the baseline budget')$$,
  'self Gate 5 checklist has no investor-agreement or funds-received item');
select results_eq($$select label from public.gate_checklist_items
    where project_id = current_setting('test.solo')::uuid and stage_id = 'post' order by position$$,
  $$values ('Final cut locked'), ('CBFC certificate issued'), ('Delivery package reviewed and accepted internally (no external buyer)')$$,
  'self Gate 8 checklist keeps final-cut and certification checks and drops buyer acceptance');
select results_eq($$select actor_id, detail ->> 'setting', detail ->> 'from', detail ->> 'to' from public.audit_events
    where project_id = current_setting('test.solo')::uuid and action = 'project.mode_changed' order by id$$,
  $$values ('d1000000-0000-0000-0000-000000000001'::uuid, 'financing', 'external', 'self'),
           ('d1000000-0000-0000-0000-000000000001'::uuid, 'distribution', 'external', 'self')$$,
  'each mode change is audited with the real producer');
select public.set_project_mode(current_setting('test.solo')::uuid, 'financing', 'self');
select is((select count(*)::int from public.audit_events
    where project_id = current_setting('test.solo')::uuid and action = 'project.mode_changed'), 2,
  'repeating the current mode changes and records nothing');
select throws_ok($$insert into public.producer_attestations (project_id, stage_id) values (current_setting('test.solo')::uuid, 'finance')$$,
  'P0001', null, 'cannot attest before the gate opens');

-- Gates 1-4.
update public.gate_checklist_items set done = true where project_id = current_setting('test.solo')::uuid and stage_id = 'ideate';
insert into public.approval_decisions (project_id, stage_id, acting_role, decision) values
  (current_setting('test.solo')::uuid, 'ideate', 'producer', 'approve');
update public.gate_checklist_items set done = true where project_id = current_setting('test.solo')::uuid and stage_id = 'develop';
insert into public.approval_decisions (project_id, stage_id, acting_role, decision) values
  (current_setting('test.solo')::uuid, 'develop', 'writer', 'approve'),
  (current_setting('test.solo')::uuid, 'develop', 'director', 'approve'),
  (current_setting('test.solo')::uuid, 'develop', 'producer', 'approve');
update public.gate_checklist_items set done = true where project_id = current_setting('test.solo')::uuid and stage_id = 'write';
insert into public.approval_decisions (project_id, stage_id, acting_role, decision) values
  (current_setting('test.solo')::uuid, 'write', 'director', 'approve'),
  (current_setting('test.solo')::uuid, 'write', 'producer', 'approve');
update public.gate_checklist_items set done = true where project_id = current_setting('test.solo')::uuid and stage_id = 'protect';
insert into public.approval_decisions (project_id, stage_id, acting_role, decision) values
  (current_setting('test.solo')::uuid, 'protect', 'writer', 'approve'),
  (current_setting('test.solo')::uuid, 'protect', 'producer', 'approve');

-- Gate 5, self-financed.
update public.gate_checklist_items set done = true where project_id = current_setting('test.solo')::uuid and stage_id = 'finance';
select throws_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.solo')::uuid, 'finance', 'producer', 'approve')$$, 'P0001', null,
  'self Gate 5 refuses decisions while the attestation is missing');
select throws_ok($$insert into public.producer_attestations (project_id, stage_id, signer_id)
  values (current_setting('test.solo')::uuid, 'finance', 'd7000000-0000-0000-0000-000000000007')$$, '42501', null,
  'clients cannot choose the attestation signer');
select throws_ok($$insert into public.producer_attestations (project_id, stage_id, statement)
  values (current_setting('test.solo')::uuid, 'finance', 'Funds received and verified')$$, '42501', null,
  'clients cannot write the attestation statement');
select throws_ok($$insert into public.producer_attestations (project_id, stage_id, statement)
  values (current_setting('test.solo')::uuid, 'finance', '')$$, '42501', null,
  'clients cannot supply even the empty default statement');
select ok(not has_column_privilege('authenticated', 'public.producer_attestations', 'statement', 'INSERT')
  and not has_column_privilege('authenticated', 'public.producer_attestations', 'statement', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.producer_attestations', 'signer_id', 'INSERT'),
  'clients hold no insert or update privilege on statement or signer_id');
-- The same two fields a typed supabase-js insert sends now that statement is optional in Insert.
select lives_ok($$insert into public.producer_attestations (project_id, stage_id) values (current_setting('test.solo')::uuid, 'finance')$$,
  'producer attests self-financing');
select is((select statement from public.producer_attestations where project_id = current_setting('test.solo')::uuid and stage_id = 'finance'),
  'I confirm, as an authorized producer, that this project is self-financed, its production budget has been reviewed, '
  'and I accept responsibility for the stated financing plan. This declaration is not an external investor approval.',
  'the stored statement is the full server declaration, not the empty default');
select results_eq($$select signer_id, statement like 'I confirm, as an authorized producer, that this project is self-financed,%'
                     and statement like '%This declaration is not an external investor approval.', created_at = now()
    from public.producer_attestations where project_id = current_setting('test.solo')::uuid and stage_id = 'finance'$$,
  $$values ('d1000000-0000-0000-0000-000000000001'::uuid, true, true)$$,
  'attestation records the real signer, the fixed statement and the server time');
select ok(exists (select 1 from public.audit_events where project_id = current_setting('test.solo')::uuid
  and action = 'gate.attested' and actor_id = 'd1000000-0000-0000-0000-000000000001' and detail ->> 'stage' = 'finance'),
  'attestation is audited');
select throws_ok($$insert into public.producer_attestations (project_id, stage_id) values (current_setting('test.solo')::uuid, 'finance')$$,
  '23505', null, 'a gate takes one attestation');
select throws_ok($$select public.set_project_mode(current_setting('test.solo')::uuid, 'financing', 'external')$$,
  'P0001', null, 'financing mode locks once the gate has progress');
select lives_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.solo')::uuid, 'finance', 'producer', 'approve')$$, 'producer approves Gate 5');
select is((select status::text from public.project_stages where project_id = current_setting('test.solo')::uuid and stage_id = 'finance'),
  'passed', 'self Gate 5 passes with producer approval and attestation, no investor');
select throws_ok($$select public.set_project_mode(current_setting('test.solo')::uuid, 'financing', 'external')$$,
  'P0001', null, 'financing mode cannot change after Gate 5 passes');

-- Gates 6-7.
update public.gate_checklist_items set done = true where project_id = current_setting('test.solo')::uuid and stage_id = 'prep';
insert into public.approval_decisions (project_id, stage_id, acting_role, department, decision) values
  (current_setting('test.solo')::uuid, 'prep', 'producer', null, 'approve'),
  (current_setting('test.solo')::uuid, 'prep', 'director', null, 'approve'),
  (current_setting('test.solo')::uuid, 'prep', 'hod', 'All departments', 'approve');
update public.gate_checklist_items set done = true where project_id = current_setting('test.solo')::uuid and stage_id = 'production';
insert into public.approval_decisions (project_id, stage_id, acting_role, decision) values
  (current_setting('test.solo')::uuid, 'production', 'director', 'approve');

-- Gate 8, self-distributed.
update public.gate_checklist_items set done = true where project_id = current_setting('test.solo')::uuid and stage_id = 'post';
select throws_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.solo')::uuid, 'post', 'director', 'approve')$$, 'P0001', null,
  'self Gate 8 refuses decisions while the attestation is missing');
select lives_ok($$insert into public.producer_attestations (project_id, stage_id) values (current_setting('test.solo')::uuid, 'post')$$,
  'producer attests internal delivery acceptance');
select ok((select statement like '%This does not represent acceptance by an external buyer.' from public.producer_attestations
    where project_id = current_setting('test.solo')::uuid and stage_id = 'post'), 'Gate 8 attestation disclaims buyer acceptance');
insert into public.approval_decisions (project_id, stage_id, acting_role, decision) values
  (current_setting('test.solo')::uuid, 'post', 'director', 'approve');
select is((select status::text from public.project_stages where project_id = current_setting('test.solo')::uuid and stage_id = 'post'),
  'active', 'director final cut alone does not pass self Gate 8');
select lives_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.solo')::uuid, 'post', 'producer', 'approve')$$, 'same person accepts delivery as producer');
select is((select status::text from public.project_stages where project_id = current_setting('test.solo')::uuid and stage_id = 'post'),
  'passed', 'self Gate 8 passes with director and producer capacities');

update public.gate_checklist_items set done = true where project_id = current_setting('test.solo')::uuid and stage_id = 'release';
insert into public.approval_decisions (project_id, stage_id, acting_role, decision) values
  (current_setting('test.solo')::uuid, 'release', 'producer', 'approve');
select is((select count(*)::int from public.project_stages where project_id = current_setting('test.solo')::uuid and status = 'passed'),
  9, 'solo: all nine stages passed');
select is((select count(*)::int from public.audit_events where project_id = current_setting('test.solo')::uuid and action = 'gate.passed'),
  9, 'solo: exactly one gate.passed per gate');
select is((select count(*)::int from public.project_members
    where project_id = current_setting('test.solo')::uuid and role in ('investor', 'client')), 0,
  'solo: no investor or buyer membership was created');
select is((select count(*)::int from public.approval_decisions
    where project_id = current_setting('test.solo')::uuid and acting_role in ('investor', 'client')), 0,
  'solo: no investor or buyer approval was recorded');
select results_eq($$select stage_id, signer_id from public.producer_attestations where project_id = current_setting('test.solo')::uuid order by id$$,
  $$values ('finance', 'd1000000-0000-0000-0000-000000000001'::uuid), ('post', 'd1000000-0000-0000-0000-000000000001'::uuid)$$,
  'solo: two attestations, both by the one producer');

reset role;
select throws_ok($$update public.producer_attestations set statement = 'edited' where project_id = current_setting('test.solo')::uuid$$,
  '42501', null, 'attestations cannot be edited, even by the table owner');
select throws_ok($$delete from public.producer_attestations where project_id = current_setting('test.solo')::uuid$$,
  '42501', null, 'attestations cannot be deleted, even by the table owner');
set local role authenticated;

-- ================================================================ 2. Team, external financing, self-distribution
select pg_temp.as_user('d2000000-0000-0000-0000-000000000002');
select set_config('test.team', public.create_project('Team Self Release', 'TEAM-2')::text, true);
insert into public.project_members (project_id, user_id, role) values
  (current_setting('test.team')::uuid, 'd3000000-0000-0000-0000-000000000003', 'producer'),
  (current_setting('test.team')::uuid, 'd4000000-0000-0000-0000-000000000004', 'director'),
  (current_setting('test.team')::uuid, 'd5000000-0000-0000-0000-000000000005', 'investor');

select pg_temp.as_user('d4000000-0000-0000-0000-000000000004');
select throws_ok($$select public.set_project_mode(current_setting('test.team')::uuid, 'distribution', 'self')$$,
  '42501', null, 'a director cannot change the distribution mode');
select pg_temp.as_user('d5000000-0000-0000-0000-000000000005');
select throws_ok($$select public.set_project_mode(current_setting('test.team')::uuid, 'financing', 'self')$$,
  '42501', null, 'an investor cannot change the financing mode');
select pg_temp.as_user('d7000000-0000-0000-0000-000000000007');
select throws_ok($$select public.set_project_mode(current_setting('test.team')::uuid, 'financing', 'self')$$,
  '42501', null, 'a non-member cannot change another project''s mode');
select pg_temp.as_user('d2000000-0000-0000-0000-000000000002');
select lives_ok($$select public.set_project_mode(current_setting('test.team')::uuid, 'distribution', 'self')$$,
  'team producer declares self-distribution');

reset role;
select pg_temp.open_gate(current_setting('test.team')::uuid, 'finance');
set local role authenticated;
update public.gate_checklist_items set done = true
  where project_id = current_setting('test.team')::uuid and stage_id = 'finance' and position = 1;
update public.gate_checklist_items set done = false
  where project_id = current_setting('test.team')::uuid and stage_id = 'finance' and position = 1;
select throws_ok($$select public.set_project_mode(current_setting('test.team')::uuid, 'financing', 'self')$$,
  'P0001', null, 'a checklist tick locks the mode even after it is unticked');
select throws_ok($$insert into public.producer_attestations (project_id, stage_id) values (current_setting('test.team')::uuid, 'finance')$$,
  'P0001', null, 'an externally financed Gate 5 takes no self-financing attestation');
update public.gate_checklist_items set done = true where project_id = current_setting('test.team')::uuid and stage_id = 'finance';
insert into public.approval_decisions (project_id, stage_id, acting_role, decision) values
  (current_setting('test.team')::uuid, 'finance', 'producer', 'approve');
select is((select status::text from public.project_stages where project_id = current_setting('test.team')::uuid and stage_id = 'finance'),
  'active', 'external Gate 5 still waits for the investor');
select pg_temp.as_user('d5000000-0000-0000-0000-000000000005');
insert into public.approval_decisions (project_id, stage_id, acting_role, decision) values
  (current_setting('test.team')::uuid, 'finance', 'investor', 'approve');
select is((select status::text from public.project_stages where project_id = current_setting('test.team')::uuid and stage_id = 'finance'),
  'passed', 'external Gate 5 passes with the investor');

reset role;
select pg_temp.open_gate(current_setting('test.team')::uuid, 'post');
set local role authenticated;
select pg_temp.as_user('d4000000-0000-0000-0000-000000000004');
select throws_ok($$insert into public.producer_attestations (project_id, stage_id) values (current_setting('test.team')::uuid, 'post')$$,
  '42501', null, 'a director cannot attest');
select pg_temp.as_user('d3000000-0000-0000-0000-000000000003');
select lives_ok($$insert into public.producer_attestations (project_id, stage_id) values (current_setting('test.team')::uuid, 'post')$$,
  'second producer attests internal delivery');
select pg_temp.as_user('d2000000-0000-0000-0000-000000000002');
select throws_ok($$insert into public.producer_attestations (project_id, stage_id) values (current_setting('test.team')::uuid, 'post')$$,
  '23505', null, 'another producer cannot attest the same gate again');
update public.gate_checklist_items set done = true where project_id = current_setting('test.team')::uuid and stage_id = 'post';
insert into public.approval_decisions (project_id, stage_id, acting_role, decision) values
  (current_setting('test.team')::uuid, 'post', 'producer', 'approve');
select is((select status::text from public.project_stages where project_id = current_setting('test.team')::uuid and stage_id = 'post'),
  'active', 'team: producer acceptance alone does not pass Gate 8');
select pg_temp.as_user('d4000000-0000-0000-0000-000000000004');
insert into public.approval_decisions (project_id, stage_id, acting_role, decision) values
  (current_setting('test.team')::uuid, 'post', 'director', 'approve');
select is((select status::text from public.project_stages where project_id = current_setting('test.team')::uuid and stage_id = 'post'),
  'passed', 'team: self Gate 8 passes with director and producer, no buyer member');
select results_eq($$select a.signer_id, d.signer_id, d.acting_role::text from public.producer_attestations a
    join public.approval_decisions d using (project_id, stage_id)
    where a.project_id = current_setting('test.team')::uuid and a.stage_id = 'post' order by d.id$$,
  $$values ('d3000000-0000-0000-0000-000000000003'::uuid, 'd2000000-0000-0000-0000-000000000002'::uuid, 'producer'),
           ('d3000000-0000-0000-0000-000000000003'::uuid, 'd4000000-0000-0000-0000-000000000004'::uuid, 'director')$$,
  'team: attestation and signatures keep their real authors');
select is((select count(*)::int from public.audit_events where project_id = current_setting('test.team')::uuid
    and action = 'gate.passed' and target_id in ('finance', 'post')), 2, 'team: one gate.passed each for Gates 5 and 8');

select pg_temp.as_user('d7000000-0000-0000-0000-000000000007');
select is((select count(*)::int from public.producer_attestations where project_id = current_setting('test.team')::uuid), 0,
  'a non-member cannot see another project''s attestations');
select is((select count(*)::int from public.projects where id = current_setting('test.team')::uuid), 0,
  'a non-member cannot see another project''s modes');
select throws_ok($$insert into public.producer_attestations (project_id, stage_id) values (current_setting('test.team')::uuid, 'post')$$,
  '42501', null, 'a non-member cannot attest on another project');

-- ================================================================ 3. Solo, self-financed, external buyer
select pg_temp.as_user('d1000000-0000-0000-0000-000000000001');
select set_config('test.fest', public.create_project('Solo Festival Sale', 'FEST-1')::text, true);
insert into public.project_members (project_id, user_id, role) values
  (current_setting('test.fest')::uuid, auth.uid(), 'director'),
  (current_setting('test.fest')::uuid, 'd6000000-0000-0000-0000-000000000006', 'client');
reset role;
select pg_temp.open_gate(current_setting('test.fest')::uuid, 'finance');
set local role authenticated;
select lives_ok($$select public.set_project_mode(current_setting('test.fest')::uuid, 'financing', 'self')$$,
  'a producer can still declare while the gate is open with no progress');
reset role;
select pg_temp.open_gate(current_setting('test.fest')::uuid, 'post');
set local role authenticated;
select results_eq($$select financing_mode::text, distribution_mode::text from public.projects where id = current_setting('test.fest')::uuid$$,
  $$values ('self', 'external')$$, 'mixed: self-financed, externally distributed');
select results_eq($$select roles::text from public.gate_requirements
    where project_id = current_setting('test.fest')::uuid and stage_id = 'post' order by roles::text$$,
  $$values ('{client}'), ('{director}')$$, 'mixed: external Gate 8 keeps director + buyer');
select throws_ok($$insert into public.producer_attestations (project_id, stage_id) values (current_setting('test.fest')::uuid, 'post')$$,
  'P0001', null, 'an externally distributed Gate 8 takes no internal-delivery attestation');
update public.gate_checklist_items set done = true where project_id = current_setting('test.fest')::uuid and stage_id = 'post';
insert into public.approval_decisions (project_id, stage_id, acting_role, decision) values
  (current_setting('test.fest')::uuid, 'post', 'director', 'approve');
select is((select status::text from public.project_stages where project_id = current_setting('test.fest')::uuid and stage_id = 'post'),
  'active', 'mixed: external Gate 8 waits for the buyer');
select pg_temp.as_user('d6000000-0000-0000-0000-000000000006');
insert into public.approval_decisions (project_id, stage_id, acting_role, decision) values
  (current_setting('test.fest')::uuid, 'post', 'client', 'approve');
select is((select status::text from public.project_stages where project_id = current_setting('test.fest')::uuid and stage_id = 'post'),
  'passed', 'mixed: external Gate 8 passes with the real buyer');

-- ================================================================ Anonymous sign-in JWT
-- A real producer's id, but the token is an anonymous session: no mode change, policy swap or audit row.
select pg_temp.as_user('d1000000-0000-0000-0000-000000000001');
select set_config('test.anon', public.create_project('Anonymous Token Check', 'ANON-1')::text, true);
select set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000001',
  'role', 'authenticated', 'is_anonymous', true)::text, true);
select throws_ok($$select public.set_project_mode(current_setting('test.anon')::uuid, 'financing', 'self')$$,
  '42501', null, 'an anonymous-session JWT cannot change a mode, even with a producer''s sub');
select pg_temp.as_user('d1000000-0000-0000-0000-000000000001');
select results_eq($$select financing_mode::text, distribution_mode::text from public.projects where id = current_setting('test.anon')::uuid$$,
  $$values ('external', 'external')$$, 'anonymous JWT: modes unchanged');
select results_eq($$select roles::text from public.gate_requirements
    where project_id = current_setting('test.anon')::uuid and stage_id = 'finance' order by roles::text$$,
  $$values ('{investor}'), ('{producer}')$$, 'anonymous JWT: Gate 5 policy not substituted');
select is((select count(*)::int from public.audit_events
    where project_id = current_setting('test.anon')::uuid and action = 'project.mode_changed'), 0,
  'anonymous JWT: no mode-change audit event');
select lives_ok($$select public.set_project_mode(current_setting('test.anon')::uuid, 'financing', 'self')$$,
  'the same producer with a normal session still changes the mode');

-- Guests never sign, even as a producer member on an open, attested gate with a complete checklist.
insert into public.project_members (project_id, user_id, role) values
  (current_setting('test.anon')::uuid, 'd8000000-0000-0000-0000-000000000008', 'producer');
reset role;
select pg_temp.open_gate(current_setting('test.anon')::uuid, 'finance');
set local role authenticated;
update public.gate_checklist_items set done = true where project_id = current_setting('test.anon')::uuid and stage_id = 'finance';
select pg_temp.as_guest('d8000000-0000-0000-0000-000000000008');
select throws_ok($$insert into public.producer_attestations (project_id, stage_id) values (current_setting('test.anon')::uuid, 'finance')$$,
  '42501', null, 'an anonymous guest with producer membership cannot attest');
select pg_temp.as_guest('d1000000-0000-0000-0000-000000000001');
select throws_ok($$insert into public.producer_attestations (project_id, stage_id) values (current_setting('test.anon')::uuid, 'finance')$$,
  '42501', null, 'an anonymous-session JWT cannot attest, even with a producer''s sub');
select pg_temp.as_user('d1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.producer_attestations where project_id = current_setting('test.anon')::uuid), 0,
  'rejected guest attempts leave no attestation');
select lives_ok($$insert into public.producer_attestations (project_id, stage_id) values (current_setting('test.anon')::uuid, 'finance')$$,
  'a non-anonymous producer still attests');
select pg_temp.as_guest('d8000000-0000-0000-0000-000000000008');
select throws_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.anon')::uuid, 'finance', 'producer', 'approve')$$, '42501', null,
  'an anonymous guest with producer membership cannot sign a gate');
select pg_temp.as_guest('d1000000-0000-0000-0000-000000000001');
select throws_ok($$insert into public.approval_decisions (project_id, stage_id, acting_role, decision)
  values (current_setting('test.anon')::uuid, 'finance', 'producer', 'approve')$$, '42501', null,
  'an anonymous-session JWT cannot sign a gate, even with a producer''s sub');
select pg_temp.as_user('d1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.approval_decisions where project_id = current_setting('test.anon')::uuid), 0,
  'rejected guest signatures leave no decision');
select is((select status::text from public.project_stages where project_id = current_setting('test.anon')::uuid and stage_id = 'finance'),
  'active', 'rejected guest signatures do not pass the gate');

-- ================================================================ Sessions without a person
reset role;
grant insert on public.producer_attestations to service_role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$insert into public.producer_attestations (project_id, stage_id) values (current_setting('test.fest')::uuid, 'finance')$$,
  '42501', null, 'service-role (agent/server) code cannot attest');
select throws_ok($$select public.set_project_mode(current_setting('test.fest')::uuid, 'distribution', 'self')$$,
  '42501', null, 'service-role code cannot change a mode');
reset role;
set local role anon;
select throws_ok($$select public.set_project_mode(current_setting('test.fest')::uuid, 'distribution', 'self')$$,
  '42501', null, 'anonymous callers cannot change a mode');
reset role;

select * from finish();
rollback;
