# Phase 1C.1 — Home idea persistence and agent-run foundation

**Status:** feature branch only; do not run on hosted Supabase until this PR is reviewed and merged.  
**Target:** the existing \`mithraa.SHI\` Next.js + Supabase repository.  
**Next phase:** 1C.2 (Groq adapter and four real agents).

## Product contract

The v2 designer brief makes Home's composer the entry point for ideas. The production requirement supersedes its sample-only assumption: the user must eventually run real agents, resume their work across sessions, view provenance, and explicitly decide whether to create a film project.

The existing files \`components/studio/ideaEngine.ts\` and \`components/studio/useRun.ts\` currently use deterministic results and timers. **This PR does not change those files or ship working AI.** It installs the security/persistence layer first.

## New tables

| Table | Purpose |
| --- | --- |
| \`public.idea_drafts\` | Owner-scoped input, language, 10 template types, production mode, quality tier, optional project link |
| \`public.idea_versions\` | Append-only-by-privilege, immutable input snapshots; historical run provenance |
| \`public.agent_runs\` | Owner, idea version, real lifecycle, model mode, configuration, idempotency and cancellation request |
| \`public.agent_steps\` | Four named agents, execution status, structured JSONB output, provider/model, retries/errors |
| \`public.research_sources\` | HTTPS citations and retrieval dates for evidence-backed Market/IP output |
| \`public.agent_usage\` | Measured vs estimated usage and optional true cost; no fake wallet |

Tables are separate from the existing \`projects\`, \`project_members\`, \`project_stages\`, \`approval_decisions\`, \`brain_records\`, and \`audit_events\`. An idea can exist without creating a project or bypassing Gate 1.

RLS is enabled on all six new tables; only the owner can read. The client has **SELECT ONLY**, no INSERT/UPDATE/DELETE grants. Any agent-authored output and provider usage requires the trusted backend, never direct client input.

## Authenticated API/RPC contract

These existing-Auth-session RPCs are available through \`supabase.rpc\`:

| Function | Inputs | Result | Notes |
| --- | --- | --- | --- |
| \`create_idea_draft\` | \`p_original_text\`, optional \`p_working_title\`, \`p_source_type\`, \`p_language_code\`, \`p_template_key\`, \`p_production_mode\`, \`p_quality_tier\` | UUID | Creates first version atomically; owner = \`auth.uid()\` |
| \`revise_idea_draft\` | \`p_idea_id\`, \`p_original_text\`, optional title and change note | Integer | Locks and increments revision; refuses submitted/converted |
| \`set_idea_parked\` | \`p_idea_id\`, \`p_parked\` | void | Toggles draft/parked only |
| \`queue_idea_agent_run\` | \`p_idea_id\`, \`p_idempotency_key\`, optional \`p_model_mode\`, \`p_request_options\` | UUID | Idempotent; creates four queued steps; only one active run per idea; ten requests per rolling 24h per user |
| \`request_idea_run_cancel\` | \`p_run_id\` | void | Requests cancellation; worker decides terminal state |

Stable idempotency keys should be generated once for an attempt and reused on network retries (not regenerated per retry). The allowed pattern is 16–128 letters, numbers, hyphens or underscores; \`crypto.randomUUID()\` works.

Expected lifecycle:
- \`queued → running → completed | partial | failed | cancelled\`
- Each individual step is \`queued → running → completed | failed | skipped\`
- A cancelled-request flag is **not** proof the worker has stopped.
- A completed step must have a validated structured output and real provider metadata.
- The signed-in browser must never be trusted to update status, cost, or the AI result.

For 1C.2/1C.3: run a server-only worker with trusted Supabase credentials, reserve the run, process each real Groq request, validate structured output, store sources, record usage, then atomically transition step/run states. Limit concurrency and support provider 429/backoff, failed-step retry and interrupted-run recovery. A queue record **alone does not start an agent**.

## Security boundaries

- Authentication is mandatory. Anonymous JWTs are rejected.
- User ID comes from server-side Supabase Auth context; callers cannot supply another owner ID.
- Cross-user reads and writes fail under RLS/owner-qualified RPCs.
- Every run points to the idea and the exact immutable version used.
- Client callers cannot impersonate an agent or invent a token bill.
- Existing \`BrainProvider\` role-switcher only simulates personas; never use it for authorization.
- Real project creation must use the existing \`public.create_project()\` path with genuine Supabase role-based checks and should be transactional/idempotent.
- This PR doesn't change existing production gates or auto-approve anything.
- \`GROQ_API_KEY\` stays server-only; it is **not** required to apply this migration and must not be exposed with \`NEXT_PUBLIC_\`.
- JSON output and request options are size-limited; source URLs are HTTPS-only.
- The schema does **not** yet implement a wallet, payment processing, multi-model Compare, audio assets or autonomous background workers.

## Database testing

Run exclusively against a throwaway **local** Supabase stack:

\`\`\`powershell
npx supabase start
npx supabase db reset --local
npx supabase test db --local
\`\`\`

The new \`supabase/tests/home_idea_persistence.test.sql\` has **36 assertions**:
- anonymous and direct client writes rejected
- saved draft/version and choice persistence
- revision history and validation
- run queue, four agent rows, true queued status
- retry idempotency / duplicate run refusal
- quota-related foundation and cancellation request
- spoofed output and usage writes rejected
- cross-user isolation and forbidden mutations

CI already runs all pgTAP suites and concurrency tests via an isolated local Supabase stack. Run the full existing TypeScript, lint, unit, Playwright, production-build and Ponytail security review checks before marking the PR ready.

### Known limits / handoff

- Production migrations are **not** applied in this phase.
- No live Groq calls or provider-verified test are claimed.
- There is no worker to move queued runs to terminal state yet.
- These data structures deliberately do not replace the sample Kolam world or existing Home UI yet.
- Confirm grant behavior and usage of server-only service-role credentials in Phase 1C.2; no browser should receive these credentials.
- Confirm project-link authorization in Phase 1C.4 before any \`project_id\` assignment. RLS on drafts is by original owner even after linking.
- Review database impacts and backup/rollback plan before touching the production project (\`yzdqvpwziwgtkslrwirn\`).

## Acceptance boundary

**Phase 1C.1 passes** when the local migration applies cleanly, pgTAP and concurrency tests pass, two test users cannot read or mutate one another's ideas, the run is exactly-once per idempotency key, and existing Project Brain tests still pass.

**Phase 1C as a whole** is not complete until Groq executes real calls, Home displays real progress/results, owners can reopen/revise/park ideas, and project creation writes provenance to Project Brain.
