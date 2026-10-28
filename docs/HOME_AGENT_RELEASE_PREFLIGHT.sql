-- READ-ONLY preflight for migration 20261028120000_home_agent_strict_order.
-- Every statement is a SELECT; the session is forced read-only first, so even a
-- pasted write fails. Each check runs on its own, so a missing table fails one
-- check and not the rest. Interpretation: docs/HOME_AGENT_RELIABILITY_RELEASE.md §2.
--   psql "$PROD_DB_URL" -X -f docs/HOME_AGENT_RELEASE_PREFLIGHT.sql
set session characteristics as transaction read only;
\pset pager off
\echo '== P1 identity (compare host with the dashboard project ref)'
select current_database() as db, current_user as login, inet_server_addr() as host,
  current_setting('server_version') as pg, now() as checked_at;

\echo '== P2 applied migrations'
select version, name from supabase_migrations.schema_migrations order by version;

\echo '== P3 prerequisites and target (expect 3 x true, target false)'
select v.version, exists (select 1 from supabase_migrations.schema_migrations m
  where m.version = v.version) as applied
from (values ('20261026120000'),('20261026183000'),('20261026183001'),('20261028120000')) v(version);

\echo '== P4 worker RPC signatures (pre-migration: finish has 14 args, no settle function)'
select p.oid::regprocedure as signature, p.prosecdef as security_definer, p.proconfig
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('claim_home_agent_step','finish_home_agent_step','settle_home_agent_run')
order by 1::text;

\echo '== P5 rate_limit_waits column (pre-migration: 0 rows)'
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'agent_steps' and column_name = 'rate_limit_waits';

\echo '== P6 which version of 20261028120000 is live, if any'
select p.oid::regprocedure as signature,
  pg_get_functiondef(p.oid) like '%rate_limit_waits%' as current_version_live
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'finish_home_agent_step';

\echo '== P7 EXECUTE grants (only service_role may be true)'
select p.oid::regprocedure as signature, r.rolname,
  has_function_privilege(r.oid, p.oid, 'EXECUTE') as can_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
cross join pg_roles r
where n.nspname = 'public'
  and p.proname in ('claim_home_agent_step','finish_home_agent_step','settle_home_agent_run')
  and r.rolname in ('anon','authenticated','service_role')
order by 1::text, 2;

\echo '== P8 live leases (must be 0 rows right before applying)'
select s.run_id, s.agent_key, s.attempts, s.lease_expires_at,
  s.lease_expires_at > now() as lease_live
from public.agent_steps s where s.status = 'running' order by s.lease_expires_at desc;

\echo '== P9 run and step status counts'
select 'run' as kind, status, count(*) from public.agent_runs group by status
union all
select 'step', status, count(*) from public.agent_steps group by status
order by 1, 2;

\echo '== P10 active runs the migration will settle (failed step, still queued/running)'
select r.id, r.status, r.created_at from public.agent_runs r
where r.status in ('queued','running')
  and exists (select 1 from public.agent_steps s where s.run_id = r.id and s.status = 'failed');

\echo '== P11 usage rows by source'
select usage_source, count(*), sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens
from public.agent_usage group by usage_source order by 1;

\echo '== P12 PostgREST: worker RPCs visible to the API schema'
select current_setting('pgrst.db_schemas', true) as pgrst_db_schemas,
  has_schema_privilege('service_role', 'public', 'USAGE') as service_role_uses_public;
