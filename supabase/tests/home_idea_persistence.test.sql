-- Phase 1C.1: Home idea persistence, trusted run lifecycle and cross-user isolation.
-- All checks use throwaway local Supabase in CI; no production access.
begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

insert into auth.users (id, email, raw_user_meta_data) values
 ('fa000000-0000-0000-0000-000000000001','home-a@example.test','{"display_name":"Home A"}'),
 ('fa000000-0000-0000-0000-000000000002','home-b@example.test','{"display_name":"Home B"}');

-- Anonymous is denied even through SECURITY DEFINER RPCs.
set local role anon;
select throws_ok($$select public.create_idea_draft('No session')$$,
  '42501', null, 'anonymous cannot save an idea');
select throws_ok($$select * from public.idea_drafts$$,
  '42501', null, 'anonymous cannot read idea drafts');
reset role;

-- Anonymous *sign-in* carries role=authenticated; test the JWT guard, not the
-- anon SQL role's execute grant (which would fail before entering the function).
select set_config('request.jwt.claims',
  '{"sub":"fa000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;
select throws_ok($select public.create_idea_draft('Anonymous session')$,
  '42501', null, 'anonymous authenticated JWT cannot create an idea');
reset role;

select set_config('request.jwt.claims',
  '{"sub":"fa000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select set_config('test.home_idea',
  public.create_idea_draft('A fisherman finds an abandoned island', 'The Island',
  'one_line', 'en', 'theatrical_feature', 'hybrid', 'premium')::text, true);

select is((select count(*)::int from public.idea_drafts), 1,
  'owner sees newly created idea');
select is((select count(*)::int from public.idea_versions), 1,
  'initial immutable version is recorded');
select is((select current_version from public.idea_drafts), 1,
  'initial version starts at one');
select is((select status from public.idea_drafts), 'draft',
  'new idea starts as draft');
select is((select quality_tier from public.idea_drafts), 'premium',
  'chosen quality tier is persisted');
select is((select owner_id from public.idea_drafts), auth.uid(),
  'owner is taken from authenticated session');
select throws_ok($$insert into public.idea_drafts (owner_id,original_text)
  values (auth.uid(),'Forged')$$, '42501', null,
  'browser cannot directly create a trusted draft row');
select throws_ok($$update public.idea_drafts set status='converted'$$,
  '42501', null, 'browser cannot forge converted status');
select throws_ok($$delete from public.idea_drafts$$,
  '42501', null, 'browser cannot delete drafts directly');
select throws_ok($$insert into public.idea_versions
  (idea_id,owner_id,version_number,original_text)
  values (current_setting('test.home_idea')::uuid,auth.uid(),77,'fake')$$,
  '42501', null, 'browser cannot forge versions');

select is(public.revise_idea_draft(current_setting('test.home_idea')::uuid,
  'A new variation on the island', 'Island Rising', 'Revised opening'), 2,
  'authorized revision increments version');
select is((select count(*)::int from public.idea_versions), 2,
  'revisions are append-only snapshots');
select is((select original_text from public.idea_versions where version_number = 1),
  'A fisherman finds an abandoned island', 'the original text is preserved');
select is((select original_text from public.idea_drafts), 'A new variation on the island',
  'draft points to latest text');
select throws_ok($$select public.revise_idea_draft(
  '00000000-0000-0000-0000-000000000001'::uuid,'stolen')$$,
  '42501', null, 'cannot revise an unknown draft');
select throws_ok($$select public.create_idea_draft(
  'Invalid format',null,'one_line','en','fake_template')$$,
  '23514', null, 'invalid templates fail DB validation');

select set_config('test.home_run',
  public.queue_idea_agent_run(current_setting('test.home_idea')::uuid,
    'home-run-uuid-000000000000001','auto','{}'::jsonb)::text, true);
select is((select count(*)::int from public.agent_runs), 1,
  'run is queued once');
select is((select status from public.agent_runs), 'queued',
  'new run starts queued, not fake completed');
select is((select idea_version from public.agent_runs), 2,
  'run is tied to the immutable current version');
select is((select count(*)::int from public.agent_steps), 4,
  'queue atomically seeds the four named agents');
select is(public.queue_idea_agent_run(current_setting('test.home_idea')::uuid,
    'home-run-uuid-000000000000001'),
    current_setting('test.home_run')::uuid,
  'idempotent retry returns the same run');
select throws_ok($$select public.queue_idea_agent_run(
  current_setting('test.home_idea')::uuid,'home-run-uuid-000000000000002')$$,
  '23505', null, 'second concurrent run for one idea is refused');
select throws_ok($$select public.queue_idea_agent_run(
  current_setting('test.home_idea')::uuid,'short')$$,
  '22023', null, 'invalid idempotency key is rejected');
select throws_ok($$insert into public.agent_steps (run_id,agent_key,status)
  values (current_setting('test.home_run')::uuid,'idea_capture','completed')$$,
  '42501', null, 'browser cannot forge completed agent steps');
select throws_ok($$insert into public.agent_usage
  (step_id,provider,model,usage_source)
  select id,'groq','fake-model','provider' from public.agent_steps limit 1$$,
  '42501', null, 'browser cannot forge usage or credits');
select lives_ok($$select public.request_idea_run_cancel(
  current_setting('test.home_run')::uuid)$$,
  'owner can request cancellation');
select ok((select cancel_requested_at is not null from public.agent_runs),
  'cancellation requests are persisted without falsely ending a run');

-- Revising text alone must preserve the title in both draft and snapshot.
select is(public.revise_idea_draft(current_setting('test.home_idea')::uuid,
    'Changed text, same title'), 3,
  'text-only revision creates a new version');
select is((select working_title from public.idea_drafts
    where id = current_setting('test.home_idea')::uuid),
    'Island Rising', 'text-only revision preserves the draft title');
select is((select working_title from public.idea_versions
    where idea_id = current_setting('test.home_idea')::uuid and version_number = 3),
    'Island Rising', 'new version preserves the title');
select is((select idea_version from public.agent_runs where id = current_setting('test.home_run')::uuid),
  2, 'in-flight run still refers to its original immutable version');

reset role;
set local role service_role;
-- service_role may bypass RLS: trigger must still reject historical rewrites.
select throws_ok($update public.idea_versions set original_text = 'tampered'$,
  '42501', null, 'trusted worker cannot alter historical versions');
select throws_ok($delete from public.idea_versions$,
  '42501', null, 'trusted worker cannot directly delete historical versions');

-- PostgreSQL triggers, not a worker's discipline, own updated_at.
update public.agent_runs set updated_at = '2000-01-01'::timestamptz
  where id = current_setting('test.home_run')::uuid;
select ok((select updated_at > '2000-01-01'::timestamptz from public.agent_runs
    where id = current_setting('test.home_run')::uuid),
  'agent_runs updated_at is maintained by trigger');
update public.agent_steps set updated_at = '2000-01-01'::timestamptz
  where run_id = current_setting('test.home_run')::uuid;
select ok((select bool_and(updated_at > '2000-01-01'::timestamptz) from public.agent_steps
    where run_id = current_setting('test.home_run')::uuid),
  'agent_steps updated_at is maintained by trigger');
reset role;

-- Another signed-in user must see nothing and cannot mutate either draft or run.
select set_config('request.jwt.claims',
  '{"sub":"fa000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.idea_drafts), 0,
  'other user cannot read drafts');
select is((select count(*)::int from public.idea_versions), 0,
  'other user cannot read version history');
select is((select count(*)::int from public.agent_runs), 0,
  'other user cannot read agent run metadata');
select is((select count(*)::int from public.agent_steps), 0,
  'other user cannot read any agent outputs');
select throws_ok($$select public.revise_idea_draft(
  current_setting('test.home_idea')::uuid,'stolen')$$,
  '42501', null, 'other user cannot revise a draft');
select throws_ok($$select public.queue_idea_agent_run(
  current_setting('test.home_idea')::uuid,'cross-user-uuid-00000000001')$$,
  '42501', null, 'other user cannot queue jobs for that draft');
select throws_ok($$select public.request_idea_run_cancel(
  current_setting('test.home_run')::uuid)$$,
  '42501', null, 'other user cannot cancel somebody elses run');

reset role;
select * from finish();
rollback;
