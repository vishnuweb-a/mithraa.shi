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

\`HOME_GROQ_EXECUTION_ENABLED=false\` by default. To enable real model requests **only after staging review**, the server needs:

- \`HOME_GROQ_EXECUTION_ENABLED=true\`
- \`GROQ_API_KEY\`: secret Groq key already used by the merged adapter
- \`SUPABASE_SERVICE_ROLE_KEY\`: **legacy service_role JWT**, not publishable/anon key, for the same Supabase project.

All 3 values must be available only to the server. Never set \`NEXT_PUBLIC_\` for secrets, and never paste real keys into GitHub/CI/tests.

The execution endpoints are not automatically invoked by a deployment. The Home prototype still uses its existing deterministic workflow until Phase 1C.4 integrates this API.

## Reliability semantics

- Each \`advance\` invocation performs **at most one leased agent step**. Market Scout makes **two Groq calls**, potentially close to 50 seconds. The route asks Next/Vercel for a 60-second maximum duration; confirm the deployment plan permits it.
- The database handles delayed retries (bounded Retry-After), stale lease expiry, concurrent claims, cancellation, and three-attempt limits.
- A browser disconnect does not ensure model-side cancellation. The DB token prevents late results from replacing a newer claim, but a Groq request completed immediately before a crash can still be charged again.
- After a retryable failure, \`GET\` exposes \`next_attempt_at\`; a later owner-initiated \`advance\` is needed to resume. **No cron/scheduler is included. A run will NOT automatically complete while its owner is offline.**
- All error messages returned from the public API are stable, sanitized codes. The worker never persists full Groq/provider error details, user prompts as log entries or service-role credentials.
- **Usage is not a full spending ledger**: `agent_usage` only stores successfully committed steps. Cancelled, rejected/invalid model output, interrupted requests and lost leases can incur real Groq token charges without corresponding persisted usage. Do not report these rows as total provider spend or deduct customer credits based solely on them. A separate provider-side billing/reconciliation design is needed before charging users.
- Source URL being present in model search output is provenance evidence, **not** independent claim verification.
- The DB snapshot used by an agent includes the immutable idea text/version. Format/language/style are read from the owner-scoped draft row; Phase 1C.4 must avoid editing those options mid-run until they're also snapshotted.

## Staging validation required

1. Create a **separate staging Supabase project** and deploy the migration history there; configure an isolated Preview/staging deployment with that project's own URL, publishable key, service_role JWT, users and auth redirect URLs. A Vercel Preview URL connected to the production Supabase project is **not isolation**. Use a dedicated staging Groq budget and explicit execution opt-in only after security review. Verify all three keys point to the intended staging stack before any real request.
2. Check Supabase linked project and RLS, cross-account 404s, 10-runs/24h limit, duplicate idempotency, bad origins, and concurrent \`advance\` calls.
3. Using an approved staging Groq budget, run one Idea Capture to verify strict JSON schemas and a Market Scout to verify \`browser_search\` plus \`tool_choice: required\`. Provider capability is **not yet confirmed with a live key**.
4. Confirm owner cancellation, next-attempt backoff, provider 429, schema validation failures, lease expiry, and that successful-step usage rows are not duplicated. Validate that invalid model pins submitted directly via the authenticated Supabase queue RPC are rejected before provider calls (terminal failure, not retry loops).
5. Keep production \`HOME_GROQ_EXECUTION_ENABLED=false\` until subsequent sign-off.

No production release, model call, database push, or merge may be performed automatically from this PR.

## Scope boundary

**This PR is the authenticated backend runner**, not the final autonomous worker. Phase 1C.4 connects Home controls to these endpoints, safely schedules owner-driven progression, and shows honest source provenance and progress. A later phase must provide a separate secure scheduler if completion when nobody has the page open is required.
