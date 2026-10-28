-- Isolated pgTAP tests for strict agent order and the failure policy.
-- Never run this fixture on a production database.
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

insert into auth.users (id,email)
values ('f4000000-0000-0000-0000-000000000001','strict-order@example.test');

-- Five runs, one idea each (one active run per idea).
select set_config('request.jwt.claims',
  '{"sub":"f4000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.run_' || n,
  public.queue_idea_agent_run(public.create_idea_draft('Strict order idea ' || n),
    'strict-order-test-key-' || n)::text,true)
from generate_series(1,5) n;
select throws_ok($$select public.settle_home_agent_run(gen_random_uuid(),now())$$,
  '42501',null,'browser cannot call the internal settle helper');
reset role;

-- Helpers are created as the test owner, then granted to the worker role.
create temp table lease (step_id uuid, token uuid) on commit drop;
create function pg_temp.claim(p_run text) returns void language sql as $$
  delete from lease;
  insert into lease select c.step_id, c.lease_token
    from public.claim_home_agent_step(current_setting('test.' || p_run)::uuid) c;
$$;
create function pg_temp.complete(p_output jsonb) returns boolean language sql as $$
  select public.finish_home_agent_step((select step_id from lease),(select token from lease),
    'completed',p_output,'groq','openai/gpt-oss-20b','home-agents-v2',10,20,'provider');
$$;
create function pg_temp.fail(p_code text, p_retryable boolean, p_detail text default null)
returns boolean language sql as $$
  select public.finish_home_agent_step((select step_id from lease),(select token from lease),
    'failed',p_provider => 'groq',p_model => 'openai/gpt-oss-20b',
    p_input_tokens => 100,p_output_tokens => 40,p_usage_source => 'provider',
    p_error_code => p_code,p_retryable => p_retryable,p_error_detail => p_detail);
$$;
create function pg_temp.step(p_run text, p_agent text) returns public.agent_steps language sql as $$
  select * from public.agent_steps
  where run_id = current_setting('test.' || p_run)::uuid and agent_key = p_agent;
$$;

grant all on lease to service_role;

select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$select public.settle_home_agent_run(gen_random_uuid(),now())$$,
  '42501',null,'worker cannot call the internal settle helper directly');

-- Run 1: two agents complete, Premise Scorer fails terminally.
select pg_temp.claim('run_1'); select pg_temp.complete('{"title":"Archive"}');
select pg_temp.claim('run_1'); select pg_temp.complete('{"audience":"Regional"}');
select pg_temp.claim('run_1');
select is((select agent_key from public.agent_steps where id=(select step_id from lease)),
  'premise_scorer','third claim is Premise Scorer');
select is(pg_temp.fail('provider_auth',false),true,'terminal failure is committed');
select is((pg_temp.step('run_1','premise_scorer')).status,'failed','Premise Scorer failed');
select is((pg_temp.step('run_1','ip_scout')).status,'skipped','IP Scout is skipped, not run');
select is((pg_temp.step('run_1','ip_scout')).error_code,'prerequisite_failed','skip reason recorded');
select is((select status from public.agent_runs where id=current_setting('test.run_1')::uuid),
  'partial','run is terminal partial in the same call');
select is((pg_temp.step('run_1','market_scout')).output,'{"audience":"Regional"}'::jsonb,
  'completed outputs are preserved');
select is((select count(*)::int from public.claim_home_agent_step(current_setting('test.run_1')::uuid)),
  0,'nothing downstream can be claimed');

-- Run 2: retryable validation failures are bounded at three attempts.
select pg_temp.claim('run_2');
select is(pg_temp.fail('agent_validation',true,'too_long@synopsis'),true,'first failure queues a retry');
select is((pg_temp.step('run_2','idea_capture')).status,'queued','step is queued for retry');
select is((pg_temp.step('run_2','idea_capture')).error_message,'too_long@synopsis','validator detail is kept');
select is((select count(*)::int from public.claim_home_agent_step(current_setting('test.run_2')::uuid)),
  0,'retry delay blocks an immediate re-claim');
reset role;
update public.agent_steps set next_attempt_at=clock_timestamp()-interval '1 second'
  where run_id=current_setting('test.run_2')::uuid;
set local role service_role;
select pg_temp.claim('run_2');
select is((pg_temp.step('run_2','idea_capture')).error_message,'too_long@synopsis',
  'claim keeps the detail for the corrective prompt');
select is((pg_temp.step('run_2','idea_capture')).error_code,null,'claim clears the visible error code');
select pg_temp.fail('agent_validation',true,'too_long@synopsis');
reset role;
update public.agent_steps set next_attempt_at=clock_timestamp()-interval '1 second'
  where run_id=current_setting('test.run_2')::uuid;
set local role service_role;
select pg_temp.claim('run_2');
select is((select attempts from public.agent_steps where id=(select step_id from lease)),3,'third attempt');
select pg_temp.fail('agent_validation',true,'too_few@dimensions');
select is((pg_temp.step('run_2','idea_capture')).status,'failed','third failure is final, not a loop');
select is((select status from public.agent_runs where id=current_setting('test.run_2')::uuid),
  'failed','run with no completed agent is failed');
select is((select count(*)::int from public.agent_steps
  where run_id=current_setting('test.run_2')::uuid and status='skipped'),3,'all downstream skipped');
select is((select input_tokens from public.agent_usage
  where step_id=(pg_temp.step('run_2','idea_capture')).id),300::bigint,
  'tokens of every failed attempt are counted');

-- Run 3: a run left 'running' by the old claim (failed step, later step queued) is repaired.
select pg_temp.claim('run_3'); select pg_temp.complete('{"title":"Archive"}');
reset role;
update public.agent_steps set status='failed',error_code='agent_validation',attempts=3,finished_at=now()
  where run_id=current_setting('test.run_3')::uuid and agent_key='market_scout';
set local role service_role;
select is((select count(*)::int from public.claim_home_agent_step(current_setting('test.run_3')::uuid)),
  0,'legacy stuck run never runs the next agent');
select is((select status from public.agent_runs where id=current_setting('test.run_3')::uuid),
  'partial','legacy stuck run is finalized');

-- Run 4: an expired lease on the final attempt fails and finalizes in one call.
select pg_temp.claim('run_4');
reset role;
update public.agent_steps set attempts=3,lease_expires_at=clock_timestamp()-interval '1 second'
  where id=(select step_id from lease);
set local role service_role;
select is((select count(*)::int from public.claim_home_agent_step(current_setting('test.run_4')::uuid)),
  0,'exhausted lease is not re-claimed');
select is((pg_temp.step('run_4','idea_capture')).error_code,'attempts_exhausted','exhaustion recorded');
select is((select status from public.agent_runs where id=current_setting('test.run_4')::uuid),
  'failed','exhausted run is finalized without another click');

select pg_temp.claim('run_1');
select is((select count(*)::int from lease),0,'terminal run stays terminal');

-- Run 5: corrective retry then success clears the detail and totals both attempts.
select pg_temp.claim('run_5');
select pg_temp.fail('agent_validation',true,'too_long@synopsis');
reset role;
update public.agent_steps set next_attempt_at=clock_timestamp()-interval '1 second'
  where run_id=current_setting('test.run_5')::uuid;
set local role service_role;
select pg_temp.claim('run_5');
select is(pg_temp.complete('{"title":"Fixed"}'),true,'corrected attempt commits');
select is((pg_temp.step('run_5','idea_capture')).error_message,null,'completion clears the retry detail');
select is((select input_tokens from public.agent_usage
  where step_id=(pg_temp.step('run_5','idea_capture')).id),110::bigint,
  'usage totals the failed and the successful attempt');

select * from finish();
rollback;
