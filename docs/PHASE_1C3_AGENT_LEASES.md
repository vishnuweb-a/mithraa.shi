# Phase 1C.3a — Trusted agent step lease and completion foundation

**Status:** database-only draft PR. The migration has **not** been pushed to the hosted Supabase project. No application route, Groq calls, browser UI, Vercel Cron task or background worker is started by these changes.

Phase 1C.1 already created a secure, idempotent `agent_runs` queue and four agent steps per run. Phase 1C.2 already merged real Groq agent/provider code. This PR adds the missing **atomic claim and completion** primitives so later server code cannot double-commit output on retries, cancellations or overlapping invocations.

## Database changes

- `agent_steps.lease_token`: random token identifying one ownership attempt.
- `agent_steps.lease_expires_at`: worker's 120-second lease, allowing recovery from interrupted serverless calls.
- `agent_steps.next_attempt_at`: backoff deadline after a transient failure.
- `agent_steps_lease_consistency`: running steps have lease metadata, non-running steps do not.
- `agent_steps_claim_idx`: partial index for the claim path.

### Worker-only RPCs

**`public.claim_home_agent_step(p_run_id)`** locks the parent run before the earliest unfinished step. It leases at most one step per run, never skips an earlier step waiting for retry, and creates a fresh ownership token on each attempt. It respects user cancellation, permits expired-lease recovery, and caps attempts at three. Any duplicate concurrent request receives no step while a live lease exists. A `NULL` run ID scans pending runs and is intended for a future trusted dispatcher.

**`public.finish_home_agent_step(...)`** checks the exact lease token and deadline before accepting a completion. It writes validated agent JSON, provider/model/prompt metadata, token usage and unverified HTTPS research source candidates in one database transaction. Wrong/expired/duplicate tokens return `false`. It schedules retryable failures with bounded backoff, records nonretryable failures and computes `completed`, `partial`, `failed` or `cancelled` run statuses.

Both routines are `SECURITY DEFINER`, with `search_path = ''`. The execution grants exclude public, `anon` and `authenticated`. They also require `auth.role() = 'service_role'`. **Never expose a service-role credential to the browser or log it.**

## Guarantees and limitations

- At-most-one **current lease** per run and step, not exactly-once external Groq billing. If a provider completed its request immediately before a crash, a later lease can repeat that paid call. That is a fundamental remote side-effect limitation unless the model provider itself supports an idempotency key.
- Late/stale workers cannot overwrite a new lease or record duplicate usage/source rows.
- Claimed requests must finish within their 120-second lease. The Phase 1C.2 Groq provider caps each call to 25 seconds; Market Scout performs two calls.
- An expired lease counts toward the three-attempt budget. Exhaustion records failure so the pipeline can proceed with partial results.
- `verified=false` means citations are *not independently fact-checked*; no URL or model answer is legal clearance.
- Step completion accepts trusted server arguments and does not itself validate the JSON contract; the subsequent worker **must call `validateOutput()`** before calling it.
- No secrets or full upstream error payloads are stored. The future worker should pass sanitized, bounded error codes only.
- A signed-in owner may request cancellation via Phase 1C.1, but a running model call may still incur usage before the worker notices. The transaction checks cancellation again before persistence.
- The `p_run_id = NULL` scan path needs fair scheduling in the dispatcher and must not be treated as a full autonomous queue by itself.
- `request_options` and model mode must be validated by the trusted server before executing a provider call. Do not trust client JSON.

## Test gates

`supabase/tests/home_agent_worker.test.sql` adds 17 pgTAP assertions covering browser access denial, step order, exclusive claims, lease-token protection, idempotent completion and usage, throttled retry, stale-token rejection, citation verification flag and queued cancellation.

CI runs this new suite with all prior pgTAP tests plus `supabase/tests/concurrency.sh`, existing Next typecheck, lint, unit/build and browser E2E checks.

**Review before merge:** Run Ponytail on the entire PR diff, including lock order, parent-run serialization, stale lease recovery and function grants.

## Phase 1C.3b — required to make agents executable

Build an authenticated Next server route that uses the signed-in Supabase user to check ownership and queue requests. Only trusted server code can use service credentials to claim/finalize a step. Add controlled retry/backoff, source candidate persistence after schema validation, resumable execution and a separately secured trigger for pending work. A live-key staging check must confirm Groq tool and JSON schema support. Then 1C.4 integrates the user-facing Home interface.

There are **no new local/production environment variables** in this database-only PR. Do not apply migrations to hosted Supabase until the owner approves and a dry run, backup and rollback procedure have been reviewed.
