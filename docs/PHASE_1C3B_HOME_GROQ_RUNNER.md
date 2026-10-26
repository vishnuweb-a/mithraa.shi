# Phase 1C.3b — Authenticated Home Groq runner

**Status:** draft, unmerged, provider-disabled by default. Database schema 1C.3a is already recorded as applied in production, but this PR adds NO migrations.

## Complete execution path

\`\`\`text
POST /api/home/ideas                          save input using user-scoped RPC
GET  /api/home/ideas                          list own saved inputs
POST /api/home/ideas/:ideaId/runs              quota + idempotent queue RPC
GET  /api/home/runs/:runId                     read own run/step progress via RLS
POST /api/home/runs/:runId/advance             authenticated one-step execution
POST /api/home/runs/:runId/cancel              request cancellation via user RPC

advance:
 verified Supabase auth.getUser() -> authorized owner lookup -> server-only
 service-role client -> atomic claim_home_agent_step(runId) -> load IMMUTABLE
 idea_versions snapshot -> select Groq model & run one of 4 real agents ->
 validate output -> finish_home_agent_step(lease token) -> results, usage,
 unverified research source candidates persisted transactionally.
\`\`\`

**No request accepts arbitrary user IDs.** Account identity is obtained from Supabase's verified session. The privileged client is never returned to the caller. Owner checks happen before the service-role lookup/claim. POST requests reject missing or cross-origin \`Origin\` headers to protect cookie auth from CSRF.

The four Phase 1C.2 agents, output schemas, research constraints, and approved Groq model IDs remain unchanged. The IP Scout never grants rights clearance. Provenance URLs are saved with \`verified=false\`.

## Activation

\`HOME_GROQ_EXECUTION_ENABLED=false\` by default. To enable real model requests **only after a controlled acceptance review**, the server needs:

- \`HOME_GROQ_EXECUTION_ENABLED=true\`
- \`GROQ_API_KEY\`: secret Groq key already used by the merged adapter
- \`SUPABASE_SERVICE_ROLE_KEY\`: **legacy service_role JWT**, not publishable/anon key, for the same Supabase project.

All four settings (activation flag, Groq key, service-role JWT and HOME_GROQ_TEST_USER_ID) must be available only to the server. The approved test user UUID must match the signed-in user before queue or advance can run; when unset, paid execution is denied to everyone. Never set \`NEXT_PUBLIC_\` for secrets, and never paste real keys into GitHub/CI/tests.

The execution endpoints are not automatically invoked by a deployment. The Home prototype still uses its existing deterministic workflow until Phase 1C.4 integrates this API.

## Reliability semantics

- Each \`advance\` invocation performs **at most one leased agent step**. Market Scout makes **two Groq calls**, potentially close to 50 seconds. The route asks Next/Vercel for a 60-second maximum duration; confirm the deployment plan permits it.
- The database handles delayed retries (bounded Retry-After), stale lease expiry, concurrent claims, cancellation, and three-attempt limits.
- A browser disconnect does not ensure model-side cancellation. The DB token prevents late results from replacing a newer claim, but a Groq request completed immediately before a crash can still be charged again.
- After a retryable failure, \`GET\` exposes \`next_attempt_at\`; a later owner-initiated \`advance\` is needed to resume. **No cron/scheduler is included. A run will NOT automatically complete while its owner is offline.**
- **Do not stop on `advance` returning `idle`.** That can indicate an active lease, pending backoff, cancellation finalization, terminal run, or attempts exhaustion. Poll `GET /api/home/runs/:runId` and stop only when `run.status` is final (`completed`, `partial`, `failed` or `cancelled`). If queued work remains and the owner wants to continue, make a later approved `advance` request.
- All error messages returned from the public API are stable, sanitized codes. The worker never persists full Groq/provider error details, user prompts as log entries or service-role credentials.
- **Usage is not a full spending ledger**: `agent_usage` only stores successfully committed steps. Cancelled, rejected/invalid model output, interrupted requests and lost leases can incur real Groq token charges without corresponding persisted usage. Do not report these rows as total provider spend or deduct customer credits based solely on them. A separate provider-side billing/reconciliation design is needed before charging users.
- Source URL being present in model search output is provenance evidence, **not** independent claim verification.
- The DB snapshot used by an agent includes the immutable idea text/version. Format/language/style are read from the owner-scoped draft row; Phase 1C.4 must avoid editing those options mid-run until they're also snapshotted.

## Acceptance plan — owner-selected production smoke test

An **isolated Supabase staging project is the recommended, lowest-risk** way to test. The owner has elected to test directly against the existing Production Supabase project after PR review and merge, without a second staging database. That is an explicit risk acceptance, not equivalent to isolated staging. Do not use a Vercel Preview connected to production Supabase as an alleged staging environment.

**Before any production opt-in:**

1. Verify a recoverable production backup and confirm project identity/migration history. Keep a rollback plan: set \`HOME_GROQ_EXECUTION_ENABLED=false\` and redeploy/restore the previous deployment as needed. The flag stops **new** execution attempts, not provider calls already in flight.
2. Keep real users out of the test: use a dedicated authenticated test user, synthetic story text only and a short maintenance/test window. Set `HOME_GROQ_TEST_USER_ID` to that user's Supabase Auth UUID. Queue and advance require this exact user; any other signed-in user receives 403 even if the execution flag is enabled. Do not use the public Home UI as an uncontrolled load driver.
3. **Mandatory spend safeguard:** On a paid Groq organization, configure a low organization-wide monthly Spend Limit and alerts before enabling; see https://console.groq.com/docs/spend-limits. Groq Spend Limits require a paid account and owner access and can lag actual spending by 10–15 minutes. If this feature is unavailable, do not enable open access: use a dedicated project/key with strict rate limits, manually limit test callers and closely monitor https://console.groq.com/ usage. Per-user 10 runs/24 hours is NOT a global budget.
4. Confirm \`HOME_GROQ_EXECUTION_ENABLED=false\` before and after the smoke test. On the production deployment, server-only \`GROQ_API_KEY\` and legacy \`SUPABASE_SERVICE_ROLE_KEY\` must match the intended production projects and must never enter client bundles, logs or version control.
5. With execution initially off, verify that queued execution is rejected with `503 agent_execution_disabled`; check signed-out requests, malformed JSON/origins, owner isolation, and invalid pins using safe non-billable checks. Run full CI, the worker mock tests and a final security review. **Do not infer the one-user `403` check passed while the flag is off:** `requireHomeExecution()` returns first.
6. Explicitly turn execution on **only for the approved short production test window**. **Before the approved account starts any work**, sign in as a second, non-approved user and call both `POST /api/home/ideas/:ideaId/runs` and `POST /api/home/runs/:runId/advance` with that user's valid same-origin session. **Both must return `403 {"error":"agent_execution_restricted"}`** without queueing or invoking Groq. If either succeeds, immediately turn the flag off and stop. Only after this check, sign in as the approved test user, create one synthetic idea and run **one Idea Capture step**. Verify real Groq structured JSON and saved database lease/usage. Then run a limited Market Scout step to test `browser_search` plus `tool_choice: required`; these capabilities remain unverified live.
7. Check idempotency, retrying after a 429, cancellation, owner-only reads, live lease behavior and research source \`verified=false\`. An invalid model pin submitted directly to the queue RPC must terminate before any Groq request.
8. Turn \`HOME_GROQ_EXECUTION_ENABLED=false\` back off, verify the deployment and stop test activity. Review the Groq Console **provider-side** usage/spend, not just \`agent_usage\`, and explicitly decide when a separate production-wide activation can be authorized.

**Do not merge, deploy, turn on production Groq, apply database changes, or make real provider calls automatically from this PR.** This PR includes no DB migrations. An approved small-scope production smoke test is **not** the same as approval to make Groq generally available to all users.

## Scope boundary

**This PR is the authenticated backend runner**, not the final autonomous worker. Phase 1C.4 connects Home controls to these endpoints, safely schedules owner-driven progression, and shows honest source provenance and progress. A later phase must provide a separate secure scheduler if completion when nobody has the page open is required. Replacing the test-user allowlist with general public access requires a separate explicit security and spending-policy review.
