# Home agent reliability — migration-first release runbook

**Scope:** PR `fix/home-ai-agent-reliability` → `main`, migration
`20261028120000_home_agent_strict_order.sql`.
**Rule:** the migration goes to production **first**. A merge to `main` deploys to Vercel production
immediately, so the PR must not merge until §3 step 7 passes.
Nothing in this document has been run against production yet. Every step marked **[APPROVAL]**
needs the owner's explicit go-ahead at that moment.

## 1. What the migration changes

| Object | Change | Effect on existing data |
|---|---|---|
| `agent_steps.rate_limit_waits` | new `smallint not null default 0` | existing rows get `0`; no table rewrite |
| `settle_home_agent_run(uuid, timestamptz)` | new internal SECURITY DEFINER function; EXECUTE revoked from `public, anon, authenticated, service_role` | none |
| `claim_home_agent_step(uuid)` | replaced in place, same signature and return type, so its service_role-only grant is kept | strict order idea → market → premise → IP; a failed step ends its run (later steps `skipped`, completed outputs kept) |
| `finish_home_agent_step` | 14-arg version dropped, 15-arg version created (adds `p_error_detail text default null`); EXECUTE for `service_role` only | usage counted for failed and cancelled attempts; a 429 with no billed tokens refunds the attempt, at most 5 times per step |
| PostgREST | `notify pgrst, 'reload schema'` | new signature visible without a restart |

**Compatibility**

- The app currently on `main` calls `finish_home_agent_step` with the 14 named arguments.
  The new function accepts them because `p_error_detail` has a default. The old app keeps working
  after the migration, so rolling back the app never needs a database rollback.
- The new app falls back to the 14-argument call on `PGRST202`, so a deploy that lands before
  the migration still records failures. The migration is still required first, because without it
  the new ordering and refund rules do not run.
- Terminal runs are never touched. Queued or running runs that already have a failed step are
  settled to `partial`/`failed` the next time a worker claims them (preflight P10 lists them).
- Usage labels: `provider` = complete, `estimated` = a known lower bound (some call did not report
  usage), `unavailable` = nothing known. The `agent_usage` check constraint already allows all three.

## 2. Read-only preflight

Run `docs/HOME_AGENT_RELEASE_PREFLIGHT.sql`. It forces the session read-only and only runs SELECTs.

```bash
# The connection string comes from Dashboard → Connect. Keep it in your shell only; never commit or paste it.
export PROD_DB_URL='postgresql://postgres.<PROD_REF>:<password>@<pooler-host>:5432/postgres'
psql "$PROD_DB_URL" -X -f docs/HOME_AGENT_RELEASE_PREFLIGHT.sql | tee preflight-before.txt
```

| Check | Expected before | Expected after | If not |
|---|---|---|---|
| P1 identity | host/ref matches the production project chosen in step 1 | same | STOP: wrong database |
| P2/P3 history | `20261026120000`, `…183000`, `…183001` applied; `20261028120000` not | all four applied | prerequisite missing: STOP, plan those migrations separately |
| P4 signatures | claim(uuid); finish with 14 args; no settle | finish ends in `jsonb,text`; settle present | see "already applied" below |
| P5 column | 0 rows | `smallint`, `NO`, `0` | see below |
| P6 live version | `false` | `true` | see below |
| P7 grants | only `service_role` true for claim/finish | same; settle false for all three roles | STOP: grant drift |
| P8 leases | no row with `lease_live = true` | — | wait for the lease to expire (≤120 s) or the run to finish |
| P9–P11 | record the counts for the after-comparison | — | — |

**`20261028120000` already recorded as applied:** do **not** replay it, edit it, or run
`supabase migration repair`. If P5/P6 show the column and `current_version_live = true`, the
current version is live: skip step 6. If they don't, an earlier draft (commit `7227bb1`, which had
no `rate_limit_waits`) was applied. In that case write a new forward-only corrective migration
(add the column, recreate `finish_home_agent_step` from the current file, reload PostgREST),
review it, and run it through this runbook.

## 3. Release order

1. **Confirm the target project.**
   `supabase login`, then `supabase projects list`, and note the production REFERENCE ID.
   `supabase link --project-ref <PROD_REF>` (asks for the DB password and writes only the
   gitignored `supabase/.temp`). Confirm in the dashboard that this is production, not staging.
2. **Confirm prerequisites.** `supabase migration list --linked` must show every migration up to
   `20261026183001` in both columns and `20261028120000` as local-only. Then run
   `supabase db push --linked --dry-run`: it must list **exactly** `20261028120000`. If anything
   else is pending, STOP. `db push` applies everything pending and there is no per-file flag.
   Run the preflight (§2).
3. **Confirm no live leases:** P8 must have no row with `lease_live = true`. Apply in a quiet
   period. A worker that is mid-call when the migration commits still finishes correctly, because
   the new function accepts the old call. This check just keeps the lock wait short.
4. **Backup and rollback readiness.** Dashboard → Database → Backups: a backup from the last
   24 h, or PITR enabled. Also take a schema snapshot, kept outside the repo:
   `supabase db dump --linked -f ../prod-schema-pre-20261028120000.sql`.
   Note the current Vercel production deployment ID (the rollback target).
5. **[APPROVAL] Apply the migration** — record who approved and when.
6. Apply: `supabase db push --linked`. The CLI runs the file in one transaction and records the
   version in `supabase_migrations.schema_migrations`. Never paste the file into the SQL editor,
   because that skips history tracking.
7. **Verify.** Re-run the preflight (`… | tee preflight-after.txt`) and compare it with the
   "after" column. PostgREST cache and signature:
   ```bash
   # anon must be refused (expect 401/403/404, never 200)
   curl -s -o /dev/null -w '%{http_code}\n' -X POST "$SUPABASE_URL/rest/v1/rpc/finish_home_agent_step" \
     -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
     -d '{"p_step_id":"00000000-0000-0000-0000-000000000000","p_lease_token":"00000000-0000-0000-0000-000000000000","p_outcome":"failed"}'
   # service_role with p_error_detail must return `false` (unknown step: no writes). PGRST202 = stale cache.
   curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/finish_home_agent_step" \
     -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'Content-Type: application/json' \
     -d '{"p_step_id":"00000000-0000-0000-0000-000000000000","p_lease_token":"00000000-0000-0000-0000-000000000000","p_outcome":"failed","p_error_detail":"preflight"}'
   ```
   Load keys from the dashboard into your shell only. On a stale cache, run `notify pgrst, 'reload schema';`.
8. **Recheck the current app** (still the old `main`): open the home page and an existing run, and
   confirm it loads with no RPC errors in the Vercel logs.
9. **CI green** on the PR head: `verify` and `db-test` (pgTAP + race tests on a throwaway stack).
10. **[APPROVAL] Mark the PR ready for review.**
11. **[APPROVAL] Merge into `main`.** Vercel deploys production automatically. Do not enable auto-merge.
12. **Verify Vercel:** the merge commit's production deployment is `Ready`, `/login` returns 200,
    and the home page loads signed in.
13. **[APPROVAL — live Groq] Smoke test:** one idea from one test account. Then check:
    ```sql
    select s.agent_key, s.status, s.attempts, s.rate_limit_waits, s.error_code,
           u.input_tokens, u.output_tokens, u.usage_source
    from public.agent_steps s left join public.agent_usage u on u.step_id = s.id
    where s.run_id = '<RUN_ID>' order by s.started_at nulls last;
    ```
    Expected: four `completed` steps in order idea → market → premise → IP, the run `completed`,
    and four usage rows.
14. **Monitor** for 24 h:
    ```sql
    select agent_key, status, error_code, count(*), max(attempts), max(rate_limit_waits)
    from public.agent_steps where created_at > now() - interval '24 hours'
    group by 1,2,3 order by 1,2,3;
    select usage_source, count(*), sum(input_tokens), sum(output_tokens)
    from public.agent_usage where recorded_at > now() - interval '24 hours' group by 1;
    ```
    Alert on: `attempts_exhausted` or `prerequisite_failed` spikes, `rate_limit_waits = 5`,
    any run stuck in `running` for more than 10 minutes, or a growing `unavailable` share.

## 4. Recovery

**App deployment fails or misbehaves.** In Vercel → Deployments, promote the deployment noted in
step 4 (instant rollback). The previous app is compatible with the new schema, so leave the
database alone. To stop new Groq calls without a rollback, set `HOME_GROQ_EXECUTION_ENABLED=false`
and redeploy **[APPROVAL]**. Calls already in flight still finish.

**Migration fails.** It ran in one transaction, so nothing was applied and no history row was
written. Confirm with `supabase migration list --linked` and preflight P3–P5. Save the error and
do not retry blindly. Fix the cause with a reviewed change, and never use `migration repair` to
paper over it. Never run `supabase db reset` against a shared or production database.

**Smoke test fails.** Cancel the run from the UI (`POST /api/home/runs/<id>/cancel`), then turn off
execution with the flag above or roll back the app. Keep the database as it is: completed outputs
and usage stay. Diagnose with the step query in step 13 and the `home_agent_attempt` log records
(content-free). Revert the database only if the schema itself is proven broken. In that case
write a forward-only revert migration that restores the 1C.3a `claim_home_agent_step` and
14-argument `finish_home_agent_step` from `20261026183000`/`20261026183001` and drops
`settle_home_agent_run`. Keep the column, because dropping it loses data and is unnecessary.

## 5. Known limitations

- The free-429 refund treats unknown (`null`) usage as zero. If Market Scout's research call is
  billed but reports no usage and the answer call then hits a 429, the attempt is refunded. This
  is bounded at 5 refunds per step.
- When a worker dies mid-call (its lease expires), that attempt's tokens are not recorded.
- `estimated` totals are lower bounds, not estimates of the missing part.
- Market Scout makes two Groq calls inside the 60 s `maxDuration` of the advance route.
- The shared local Supabase database is behind (no `20261026*` migrations), so DB tests run only
  in CI's throwaway stack.
