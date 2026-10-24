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
| `supabase/tests/gate_operating_models.test.sql` | 32 assertions: solo filmmaker through all nine gates, collaborative Gate 6 |
| `.github/workflows/ci.yml` | New `db-test` job: pgTAP suite and two-session race tests (`supabase/tests/concurrency.sh`) on a throwaway local Supabase stack |
| `lib/supabase/client.ts`, `server.ts`, `database.types.ts` | Browser/server clients and generated types |
| `package.json`, `package-lock.json` | `@supabase/supabase-js@2.117.3` and `@supabase/ssr@0.12.7` (exact); `db:test` and `db:types` scripts |
| `.env.example` | New variable names (placeholders only) |
| `docs/PROJECT_BRAIN_DATABASE_ARCHITECTURE.md`, `docs/SUPABASE_INTEGRATION_STATUS.md`, this file | Documentation |

## Results

| Check | Result | Detail |
| --- | --- | --- |
| Migration applies to a clean DB (`supabase db reset --local`) | **PASS** | Postgres 17 |
| pgTAP RLS/policy tests (`supabase test db`) | **PASS** 78/78 | 2 files |
| Two-session race tests (`supabase/tests/concurrency.sh`) | **PASS** 2/2 | producer-removal race, checklist-vs-final-approval race |
| Tests can fail (guard trigger dropped) | **PASS** | 4 assertions fail as expected, restored by reset |
| Tests can fail (duplicate and single-pass fixes removed) | **PASS** | 7 of 32 operating-model assertions fail, restored by reset |
| End-to-end over HTTP (GoTrue sign-up + PostgREST via supabase-js) | **PASS** 9/9 | anon refused, isolation, no self-assignment, signer forgery refused, Gate 1 pass, audit immutable |
| `supabase db advisors --local` | **PASS** | 0 warnings or errors. Info only: unindexed user-reference FKs, unused indexes on empty DB, deny-all private templates |
| `npm run typecheck` | **PASS** | |
| `npm run lint` | **PASS** | |
| `npm run build` | **PASS** | Same route table as before |
| Route smoke (`next start`, CI's list) | **PASS** | 16 × 200, `/stages/bogus` and `/nope` 404 |
| Client bundle contains no Supabase key values from `.env` | **PASS** | |
| Remote project migration | **NOT RUN** | Deliberate. Dev or prod not confirmed |
| Supabase MCP verification | **BLOCKED** | No MCP tools loaded in this session (needs OAuth) |
| DB tests in CI (`db-test` job) | See PR | Local Supabase in Docker on the runner. No link, no secrets, no remote access |

## Issues found and fixed during testing

- `service_role` gets `TRUNCATE` on new tables by default. TRUNCATE skips row triggers and could
  wipe `audit_events`. It is now revoked on both append-only tables, and a test covers it.
- `service_role` has no insert/update/delete grants on new tables in this Supabase version. The
  "agents cannot sign" test passed only because of that missing grant. The test now grants insert
  first, so the trigger guard is what gets tested.
- Gate 8 default: the blueprint asks for director plus buyer acceptance. The prototype also lists
  producer, which was dropped from the default policy.
- Solo operation review (owner clarified that one person must be able to run a whole film). The
  original schema already allowed it: roles are per person and per row, and no default rule needs
  distinct people. Two related defects were fixed. Repeating the same decision in the same role was
  accepted as an extra row; it is now rejected (`23505`). A multi-row insert that passed a gate (one
  person signing in several roles at once) wrote one `gate.passed` audit row per inserted row; it now
  writes one. 5 of the 31 new assertions failed on the original migration and all pass now. A 32nd
  assertion covers the same role twice in one statement (the duplicate check sees earlier rows of
  the same insert).

## Outstanding product requirements

Both need schema changes, but **not before this PR merges**. See architecture doc §4a for the design.

| Requirement | Today | Minimum change (later, additive migration) |
| --- | --- | --- |
| **R1. HOD approvals name the department**, even when one user is HOD of several | A decision has no `department`. One `hod` signature from a person counts for every department row they hold | Nullable `approval_decisions.department`, required when `acting_role = 'hod'` and checked against the signer's membership. Gate evaluation and the duplicate check match on it |
| **R2. Solo self-financed and self-distributed projects** without fictitious investor or buyer acceptance | Gates 5 and 8 need an investor and a client/buyer. A solo owner passes only by adding themselves in those roles, which records investor and buyer acceptance that did not happen | A producer-set, audited project declaration (financing: external or self; distribution: external or self). When self, the investor/client requirement and third-party checklist items are replaced by a producer attestation |

Why merging first is safe: the migration has never been applied to a persistent database (the
remote project has no tables), no screen writes decisions, and both changes add columns with safe
defaults. The risk is in shipping a screen that writes decisions before them: HOD decisions without
departments cannot be backfilled reliably. **Both must land before any screen writes decisions.**
R1 is well defined and can be built now. R2 needs the product decisions in architecture doc §4a.

The solo test still signs Gates 5 and 8 as investor and client. That proves one account can hold
every role. It is not the intended flow for a self-financed or self-distributed film.

## Git notes

- `docs/product-architecture-readme` has **no commits** beyond the onboarding commit. Its work
  (`README.md` edit, `docs/APPLICATION_FLOW.md`, `docs/BUSSINESS_FLOW.md`,
  `docs/PRODUCT_ARCHITECTURE_ANALYSIS.md`) is uncommitted in the working tree. It is **excluded
  from this branch's commit** and left untouched. This PR names those docs in plain text and does
  not link to them, so no link is broken before that docs PR lands.
- `.agents/`, `.mcp.json` and `skills-lock.json` (local tooling config) are also not committed.
- `docs/SUPABASE_MCP_VERIFICATION_REPORT.md` is not committed. It records the remote project ref and
  local MCP setup. The PDFs in the repo root are the owner's source documents and are not committed.

## Readiness

Ready for review as a local-development foundation, once the CI `db-test` job passes. Not ready
for remote deployment until the open policy questions (architecture doc §4, §4a) and the dev/prod
question are answered.

## Next narrowly scoped PR (proposal)

**Phase 1B: sign-in and a read-only Brain view.** Supabase email sign-in, `proxy.ts` session
refresh, and one server-rendered page that lists the signed-in user's projects and stage status
from the database. Keep the sample-data screens as they are. Before any screen writes decisions:
R1 and R2 (above), and approval questions 1 and 5.
