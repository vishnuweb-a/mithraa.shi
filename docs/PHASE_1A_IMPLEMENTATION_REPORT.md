# Phase 1A Implementation Report — Project Brain Foundation

*Branch `feat/project-brain-foundation` from `origin/main` @ `6016ba4` · 2026-10-25.*

## Scope

Delivered: a reproducible Supabase schema for projects, membership with project roles, nine
stages, a configurable multi-signer gate policy, gate checklists, append-only individual gate
decisions, Brain records with provenance, and a trigger-written audit trail. RLS and grants are
tested. Typed Supabase clients for Next.js are added but not used by any screen.

Not delivered (by design): agents, guardians, orchestration, sign-in UI, connecting screens to
the database, any remote deployment.

## Files

| File | Change |
| --- | --- |
| `supabase/config.toml`, `supabase/.gitignore` | `supabase init` (defaults) |
| `supabase/migrations/20261024183806_project_brain_foundation.sql` | Schema, RLS, triggers, grants |
| `supabase/tests/project_brain_rls.test.sql` | 46 pgTAP allow/deny assertions |
| `lib/supabase/client.ts`, `server.ts`, `database.types.ts` | Browser/server clients and generated types |
| `package.json`, `package-lock.json` | `@supabase/supabase-js@2.117.3` and `@supabase/ssr@0.12.7` (exact); `db:test` and `db:types` scripts |
| `.env.example` | New variable names (placeholders only) |
| `docs/PROJECT_BRAIN_DATABASE_ARCHITECTURE.md`, `docs/SUPABASE_INTEGRATION_STATUS.md`, this file | Documentation |

## Results

| Check | Result | Detail |
| --- | --- | --- |
| Migration applies to a clean DB (`supabase db reset --local`) | **PASS** | Postgres 17 |
| pgTAP RLS/policy tests (`supabase test db`) | **PASS** 46/46 | |
| Tests can fail (guard trigger dropped) | **PASS** | 4 assertions fail as expected, restored by reset |
| End-to-end over HTTP (GoTrue sign-up + PostgREST via supabase-js) | **PASS** 9/9 | anon refused, isolation, no self-assignment, signer forgery refused, Gate 1 pass, audit immutable |
| `supabase db advisors --local` | **PASS** | 0 warnings or errors. Info only: unindexed user-reference FKs, unused indexes on empty DB, deny-all private templates |
| `npm run typecheck` | **PASS** | |
| `npm run lint` | **PASS** | |
| `npm run build` | **PASS** | Same route table as before |
| Route smoke (`next start`, CI's list) | **PASS** | 16 × 200, `/stages/bogus` and `/nope` 404 |
| Client bundle contains no Supabase key values from `.env` | **PASS** | |
| Remote project migration | **NOT RUN** | Deliberate. Dev or prod not confirmed |
| Supabase MCP verification | **BLOCKED** | No MCP tools loaded in this session (needs OAuth) |
| DB tests in CI | **NOT RUN** | Not added to the workflow yet |

## Issues found and fixed during testing

- `service_role` gets `TRUNCATE` on new tables by default. TRUNCATE skips row triggers and could
  wipe `audit_events`. It is now revoked on both append-only tables, and a test covers it.
- `service_role` has no insert/update/delete grants on new tables in this Supabase version. The
  "agents cannot sign" test passed only because of that missing grant. The test now grants insert
  first, so the trigger guard is what gets tested.
- Gate 8 default: the blueprint asks for director plus buyer acceptance. The prototype also lists
  producer, which was dropped from the default policy.

## Git notes

- `docs/product-architecture-readme` has **no commits** beyond the onboarding commit. Its work
  (`README.md` edit, `docs/APPLICATION_FLOW.md`, `docs/BUSSINESS_FLOW.md`,
  `docs/PRODUCT_ARCHITECTURE_ANALYSIS.md`) is uncommitted in the working tree. It is **excluded
  from this branch's commit** and left untouched. Links to those docs from this PR resolve once
  that docs PR lands.
- `.agents/`, `.mcp.json` and `skills-lock.json` (local tooling config) are also not committed.

## Readiness

Ready for review as a local-development foundation. Not ready for remote deployment until the
open policy questions (architecture doc §4) and the dev/prod question are answered.

## Next narrowly scoped PR (proposal)

**Phase 1B: sign-in and a read-only Brain view.** Supabase email sign-in, `proxy.ts` session
refresh, and one server-rendered page that lists the signed-in user's projects and stage status
from the database. Keep the sample-data screens as they are. Add DB tests to CI. Settle approval
questions 1, 4 and 5 before any screen writes decisions.
