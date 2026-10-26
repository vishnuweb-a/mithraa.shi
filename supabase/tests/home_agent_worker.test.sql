-- Isolated pgTAP tests; never run this fixture on a production database.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id,email)
values ('f3000000-0000-0000-0000-000000000001','worker-a@example.test');

select set_config('request.jwt.claims',
  '{"sub":"f3000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.worker_idea',
  public.create_idea_draft('A coastal mystery about a forgotten archive')::text,true);
select set_config('test.worker_run',
  public.queue_idea_agent_run(current_setting('test.worker_idea')::uuid,
    'worker-lease-test-key-one')::text,true);

select throws_ok($$select * from public.claim_home_agent_step()$$,
  '42501',null,'browser cannot claim worker leases');
select throws_ok($$select public.finish_home_agent_step(gen_random_uuid(),gen_random_uuid(),'failed')$$,
  '42501',null,'browser cannot finish a step');
reset role;

select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('test.worker_step',step_id::text,true),
  set_config('test.worker_lease',lease_token::text,true)
  from public.claim_home_agent_step(current_setting('test.worker_run')::uuid);
select is((select agent_key from public.agent_steps
  where id=current_setting('test.worker_step')::uuid),'idea_capture','first is capture');
select is((select attempts from public.agent_steps
  where id=current_setting('test.worker_step')::uuid),1,'first claim is one attempt');
select is((select count(*)::int from public.claim_home_agent_step(
  current_setting('test.worker_run')::uuid)),0,'active lease stops double claim');

select is(public.finish_home_agent_step(
  current_setting('test.worker_step')::uuid,gen_random_uuid(),'completed',
  '{"title":"Wrong"}'::jsonb,'groq','openai/gpt-oss-20b','home-agents-v1'),
  false,'incorrect lease token denied');
select is(public.finish_home_agent_step(
  current_setting('test.worker_step')::uuid,
  current_setting('test.worker_lease')::uuid,'completed',
  '{"title":"Archive"}'::jsonb,'groq','openai/gpt-oss-20b','home-agents-v1',
  5,8,'provider'),true,'authorized worker stores result');
select is(public.finish_home_agent_step(
  current_setting('test.worker_step')::uuid,
  current_setting('test.worker_lease')::uuid,'completed',
  '{"title":"Duplicate"}'::jsonb,'groq','openai/gpt-oss-20b','home-agents-v1'),
  false,'repeated completion denied');
select is((select count(*)::int from public.agent_usage),1,'usage saved only once');

select set_config('test.market_step',step_id::text,true),
  set_config('test.market_lease',lease_token::text,true)
  from public.claim_home_agent_step(current_setting('test.worker_run')::uuid);
select is((select agent_key from public.agent_steps
  where id=current_setting('test.market_step')::uuid),'market_scout',
  'second step is Market Scout');
select is(public.finish_home_agent_step(
  current_setting('test.market_step')::uuid,
  current_setting('test.market_lease')::uuid,'failed',
  p_error_code => 'rate_limited',p_retryable => true,
  p_retry_after_seconds => 30),true,'rate limit queues retry');
select is((select count(*)::int from public.claim_home_agent_step(
  current_setting('test.worker_run')::uuid)),0,'delay blocks later steps');

update public.agent_steps set next_attempt_at=clock_timestamp()-interval '1 second'
  where id=current_setting('test.market_step')::uuid;
select set_config('test.market_new_lease',lease_token::text,true)
  from public.claim_home_agent_step(current_setting('test.worker_run')::uuid);
select isnt(current_setting('test.market_lease'),current_setting('test.market_new_lease'),
  'retry rotates the lease token');
select is(public.finish_home_agent_step(
  current_setting('test.market_step')::uuid,
  current_setting('test.market_lease')::uuid,'completed',
  '{"audience":"stale"}'::jsonb,'groq','openai/gpt-oss-20b','home-agents-v1'),
  false,'stale worker cannot commit');
select is(public.finish_home_agent_step(
  current_setting('test.market_step')::uuid,
  current_setting('test.market_new_lease')::uuid,'completed',
  '{"audience":"Unverified"}'::jsonb,'groq','openai/gpt-oss-20b',
  'home-agents-v1',20,30,'provider',
  p_sources => '[{"url":"https://example.org/report","title":"Report","claim":"Candidate"}]'::jsonb),
  true,'market result and sources commit together');
select is((select count(*)::int from public.research_sources where verified=false),
  1,'source remains unverified');

-- A new queued run is cancelled through the user RPC and settled by worker.
reset role;
select set_config('request.jwt.claims',
  '{"sub":"f3000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.cancel_idea',
  public.create_idea_draft('A second film idea')::text,true);
select set_config('test.cancel_run',
  public.queue_idea_agent_run(current_setting('test.cancel_idea')::uuid,
    'worker-lease-test-key-two')::text,true);
select public.request_idea_run_cancel(current_setting('test.cancel_run')::uuid);
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select count(*) from public.claim_home_agent_step(
  current_setting('test.cancel_run')::uuid);
select is((select status from public.agent_runs where id=current_setting('test.cancel_run')::uuid),
  'cancelled','worker settles pending cancellation');

select * from finish();
rollback;
