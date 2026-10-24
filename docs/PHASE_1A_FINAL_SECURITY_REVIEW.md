# Phase 1A — Final Security Review

PR [#2](https://github.com/vishnuweb-a/mithraa.shi/pull/2) · branch `feat/project-brain-foundation` · policy:
[DEVELOPMENT_REVIEW_POLICY.md](DEVELOPMENT_REVIEW_POLICY.md)

> **AI review, not human approval.** Both reviews below are Ponytail (`/ponytail-review`, level `full`)
> AI reviews run by Claude Code. They are not a formal independent human GitHub approval. Merge needs
> the project owner's authorization.

## Review target

| | |
| --- | --- |
| Initial review | Complete diff `main...e42c9c4` (36 files) |
| Final review | Same diff plus the fixes in this document (commit after `e42c9c4`; head SHA in the PR) |
| Read in full | the migration, both pgTAP suites, `ci.yml`, `lib/supabase/*`, `next.config.ts`, `app/stages/[stage]/page.tsx` |
| Evidence method | every finding reproduced on the local Supabase stack (Postgres 17.6) before it was accepted |
| Assumed load | a small studio team; a few people may click at the same moment |

## Initial findings

| # | Severity | Location | Problem | Reproduction | Blocks merge | Outcome |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **High** | migration, `private.audit_member_change` | Last-producer guard was check-then-write. Two producers removing each other at once both pass. | Two sessions, A removes B while B removes A: **0 producers left**. Project can no longer add members or be edited. | Yes | **Fixed** |
| 2 | **Medium** | migration, `private.before_checklist_update` | Stage status read without a lock, so an untick can land during the final approval. | Final approval held open, untick in a 2nd session: stage **`passed` with 1 undone item**. | Yes (integrity) | **Fixed** |
| 3 | Medium | `supabase/tests` | No test for either race (pgTAP is one session). | n/a | Yes | **Fixed** |
| 4 | Low | `docs/PROJECT_BRAIN_DATABASE_ARCHITECTURE.md:8-9`, migration comment | Links to `BUSSINESS_FLOW.md` / `APPLICATION_FLOW.md`, which are not committed (404 on GitHub). | Files are untracked. | No | **Fixed** (plain text) |
| 5 | Low | `gate_satisfied` / `after_decision` | Removing the last pending signer leaves the gate satisfied but `active`; only a new approval re-checks it, and re-approving in the same role is a duplicate. | `gate_satisfied` = true, status `active`. | No | **Accepted** (below) |
| 6 | Low | `projects.created_by`, `approval_decisions.signer_id` | A user who created a project or signed a gate cannot be deleted (FK error). | `delete from auth.users` → `projects_created_by_fkey`. | No | **Accepted** (below) |

Checked and found correct: multi-row inserts (BEFORE row triggers see earlier rows of the same
statement; exactly one `gate.passed` per gate), concurrent approvals (`FOR UPDATE` on the stage row
plus a fresh READ COMMITTED snapshot), `signer_id` forced to `auth.uid()`, agent / service_role
signing blocked by the trigger, column-level grants, anonymous users blocked in `create_project`,
`search_path = ''` on every SECURITY DEFINER function, no dynamic SQL, cross-project isolation.

Dropped: a suspected service_role bypass (direct update of `project_stages` / insert into
`audit_events`). The local stack grants service_role **no** DML on these tables
(`information_schema.role_table_grants`), so it does not apply. Re-check it if a later phase grants
service_role writes.

## Fixes

| # | Change |
| --- | --- |
| 1 | `audit_member_change`: before the last-producer check, lock the project row `FOR NO KEY UPDATE`. The second remover waits, sees the first removal and is refused. Cascade deletes still skip the check (`found` is false). `NO KEY` keeps FK checks on the project unblocked. |
| 2 | `before_checklist_update`: read the stage `FOR SHARE`. It waits for an in-flight approval's `FOR UPDATE`, then re-checks the row; a `passed` gate refuses the untick. |
| 3 | `supabase/tests/concurrency.sh` (two psql sessions) and a `db-test` CI step that runs it. |
| 4 | Doc links replaced by plain text. |

The fixes edit the Phase 1A migration in place. It is unmerged and has never been applied to the
remote project, so no follow-up migration is needed.

## Regression tests

| Test | Old code | Fixed code |
| --- | --- | --- |
| concurrent producer removals keep one producer | **not ok** (got 0) | ok |
| passed gate keeps a complete checklist | **not ok** (passed with 1 undone) | ok |

The checklist test asserts "passed implies every item done", so it stays green whichever session
wins and does not flake on a slow runner.

## Final review

The re-review confirmed fixes 1–4 and found no new security or correctness issues. It raised two
small items, both applied and re-tested:

- The race test assumed which session runs first. It now checks the invariant (above).
- `FOR UPDATE` → `FOR NO KEY UPDATE` on the project row, so a producer removal does not stall
  inserts into that project.

Solo and team models are unchanged. One account still holds several roles, signs once per role and
passes all nine gates. Collaborative Gate 6 still needs every HOD.

**Unresolved Critical or High findings: none.**

## Validation (actual runs, Windows 11, Docker, Supabase CLI 2.115.0)

| Check | Result |
| --- | --- |
| `supabase db reset --local` (clean migration) | PASS |
| `supabase test db --local` | PASS **78/78** (2 files) |
| `supabase/tests/concurrency.sh` | PASS **2/2** (and 0/2 on the old migration) |
| `npm run typecheck` / `lint` / `build` | PASS |
| Route smoke (`next start`, 18 URLs) | PASS: 16 × 200, `/stages/bogus` and `/does-not-exist` 404 |
| Auth / API tests | None exist; the app has no auth or API routes yet |
| GitHub CI on `e42c9c4` (before fixes) | `verify` success, `db-test` success |
| GitHub CI on the fix commit | Recorded in the PR description once it finishes |

## Remaining risks

- **Accepted 5 (stuck gate after removing a pending signer).** Rare. Workaround: one signer records
  `reject` then `approve`. A proper fix shares the pass logic with member removal (later phase).
- **Accepted 6 (account deletion blocked).** This keeps signer attribution, which the brief requires.
  A personal-data deletion request needs a deliberate anonymisation design before launch.
- **Open product requirements R1/R2** (HOD department on decisions, solo self-finance /
  self-distribution). See the architecture doc §4a. They must land before any screen writes decisions.
- Isolation levels above READ COMMITTED were not tested (PostgREST uses READ COMMITTED).
- The remote project's default grants were not inspected; nothing was applied remotely.

## Merge readiness

Ready for **owner review** once CI is green on the latest head. The PR stays a draft. Not merged, not
deployed, no remote migration.
