# HOD Department-Specific Approvals (Phase 1A.1)

*Migration: [`20261025010000_hod_department_approvals.sql`](../supabase/migrations/20261025010000_hod_department_approvals.sql) ·
Tests: [`hod_department_approvals.test.sql`](../supabase/tests/hod_department_approvals.test.sql) ·
Requirement: [PROJECT_BRAIN_DATABASE_ARCHITECTURE.md §4a R1](PROJECT_BRAIN_DATABASE_ARCHITECTURE.md#4a-required-before-any-screen-writes-decisions)*

Gate 6 (Shoot Ready) needs **every HOD**. Before this change a decision had no department, so one
person who was HOD of Camera and Sound signed once for both. Now every (HOD, department) membership
is a separate sign-off:

- **Solo filmmaker.** One account holds `hod/Camera`, `hod/Sound` and `hod/Costume` and signs three times.
- **Team.** The producer assigns departments to different people. A member can hold several.

Status: R1 is implemented. **R2 (Gate 5 self-financing, Gate 8 self-distribution) is still pending.**

## Rules

| Rule | Enforced by | Error |
| --- | --- | --- |
| A HOD membership names a department | `project_members_hod_has_department` check | `23514` |
| A HOD decision names a department; other roles cannot | `approval_decisions_department_only_for_hod` check | `23514` |
| The department is one of the signer's HOD memberships **on this project** | `before_decision` trigger | `42501` |
| Repeating your latest decision in the same role and department is a duplicate | `before_decision` | `23505` |
| Reject → approve in the same department is allowed | latest row per (signer, role, department) | — |
| "Every HOD" means every (HOD, department) membership | `gate_satisfied` | — |
| Numeric rules (`signers_required = n`) count distinct people, not departments | `gate_satisfied` (unchanged) | — |
| An approval counts only while the signer still holds that department | `gate_satisfied` | — |
| A membership change and a final signature on the open gate never overlap | `lock_open_gate` trigger | — (waits) |
| Non-HOD membership `department` stays free-form metadata | `gate_satisfied` compares departments for HOD rows only | — |

Everything else is unchanged from Phase 1A: `signer_id` is always `auth.uid()`, service-role and
agent code cannot sign, project-scoped RLS, append-only decisions and audit, one `gate.passed` per gate.

## Schema changes

| Object | Change |
| --- | --- |
| `project_members` | `check (role <> 'hod' or department is not null)` |
| `approval_decisions.department` | New `text`, 1–60 chars, nullable |
| `approval_decisions` | `check ((acting_role = 'hod') = (department is not null))` |
| Grants | `insert (department)` on `approval_decisions` to `authenticated` |
| `private.gate_satisfied` | Latest decision per (signer, role, department); HOD approvals must match a current HOD membership with that department |
| `private.before_decision` | Checks the department against the signer's HOD memberships; duplicate check includes the department |
| `private.after_decision` | `gate.decision` audit detail gains `department` |
| `private.lock_open_gate` + trigger | After insert/delete on `project_members`, takes `FOR UPDATE` on the project's stage rows in stage order |
| `lib/supabase/database.types.ts` | Regenerated: `department` on `approval_decisions` |

Departments match exactly (`'Camera'` ≠ `'camera'`, `'Sound '` ≠ `'Sound'`). **Future UI requirement:**
the screens that assign HODs and record HOD sign-offs must offer a fixed, canonical list of department
values (pick, not free text), so one department is never stored under two spellings. Until then a
misspelt assignment simply creates another required sign-off. Two people can be HOD of the same department;
each signs. The new checks would reject existing HOD memberships or decisions without a department.
None exist, because no migration has been applied to a persistent database.

## Concurrency: roster changes vs. the final approval

Invariant: **Gate 6 never passes while a department required by its policy is unsigned.**

"Every HOD" is evaluated against the live roster. Without extra locking, a producer adding a
`hod/Sound` membership in one transaction while the last other HOD signs in another let the signature
evaluate a roster without Sound, so Gate 6 passed and Sound was required but never signed.

Fix: membership inserts and deletes take the same `FOR UPDATE` row lock on the project's stages that
`before_decision` takes on the active one. All stages are locked, in stage order, so a gate that opens
while the change waits is covered as well. The two transactions now run one after the other:

- **Membership change first.** The signature waits, then sees the new roster: Gate 6 stays open
  until Sound signs. A removed signer's approval is rejected (`42501`) or no longer counts.
- **Signature first.** The membership change waits until the pass commits. The new HOD joins a
  project whose Gate 6 has already passed; passed gates are never re-evaluated.

What did not change: the roster is still live, not frozen when the gate opens (open question 7 in
the architecture doc stays the owner's decision). Solo filmmakers are unaffected. A solo owner adding
memberships and signing in one transaction already holds the lock. Membership changes on one project
now queue behind each other and behind in-flight signatures; they are rare. Locks are taken in
ascending stage order, the same order a signature uses (its stage, then the next), so no lock cycle
is added. (Two *multi-statement* client transactions that each
tick/add and then sign could still deadlock, as before. PostgREST runs one statement per request.)

Regression tests are cases 3–5 in `supabase/tests/concurrency.sh`. Cases 3 and 4 (two sessions) fail
when the trigger is dropped. Case 5 (three sessions: Gate 5 passes while a HOD is being added, then
Gate 6 is signed) fails when the trigger locks only the active stage. All pass with the trigger as shipped.

## Tests

`hod_department_approvals.test.sql`, 36 assertions:

| # | Covers |
| --- | --- |
| 1, 6–7, 20 | Non-HOD department metadata stays compatible. 20 is a regression test: the original R1 plan (`is not distinct from`) would block an "every director" row |
| 2 | A HOD membership needs a department |
| 3 | A HOD decision needs a department |
| 4, 25 | Unassigned department, or another member's department, rejected |
| 5 | A non-HOD decision cannot claim a department |
| 8–9, 13–16, 24, 26–27 | Several departments per person; each signs separately; Gate 6 passes only after all of them |
| 10 | Repeating the same decision in the same department is a duplicate |
| 11–12 | Reject then approve |
| 17–18, 29 | Records and audit name the real signer, role and department |
| 19, 28 | Exactly one `gate.passed` |
| 30–31 | "Two HODs" needs two people, not two departments |
| 32–34 | Removing or reassigning a department invalidates its approval. 34 is a regression test for numeric rules |
| 22–23, 35 | No cross-project use of a department name; outsiders see nothing |
| 36 | Service-role (agent) code cannot sign as a HOD |

The existing suites now pass departments on their HOD decisions. Their assertion counts are
unchanged (46 + 32). Total: **114 assertions**, plus 5 multi-session race tests in `concurrency.sh` (3 new).

Tests 20 and 34 were mutation-checked: each fails when its guard is removed from the migration.
