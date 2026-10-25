# Self-Financing and Self-Distribution (Phase 1A.2)

*Migration: [`20261025120000_self_financing_distribution.sql`](../supabase/migrations/20261025120000_self_financing_distribution.sql) ·
Tests: [`self_financing_distribution.test.sql`](../supabase/tests/self_financing_distribution.test.sql),
[`gate_operating_models.test.sql`](../supabase/tests/gate_operating_models.test.sql),
[`concurrency.sh`](../supabase/tests/concurrency.sh) ·
Requirement: [PROJECT_BRAIN_DATABASE_ARCHITECTURE.md §4a R2](PROJECT_BRAIN_DATABASE_ARCHITECTURE.md#4a-required-before-any-screen-writes-decisions)*

A producer declares, per project, whether financing (Gate 5) and distribution (Gate 8) are
`external` (default) or `self`. Self mode never creates an investor or buyer membership or approval.

| Mode | Gate 5 Financing Close | Gate 8 Final Delivery |
| --- | --- | --- |
| `external` | Producer + every investor (Phase 1A policy) | Director + client/buyer (Phase 1A policy) |
| `self` | Producer, after a producer attestation | Director (final cut) + producer, after a producer attestation |

## Rules

| Rule | Enforced by | Error |
| --- | --- | --- |
| Only a signed-in, non-anonymous producer of the project changes a mode | `set_project_mode` (checked after the project lock) | `42501` |
| Modes are not writable on `projects` directly | column grants | `42501` |
| A mode locks once its gate has passed or has any tick, untick, attestation or decision | `set_project_mode` | `P0001` |
| Changing a mode swaps that gate's policy and checklist and writes `project.mode_changed` | `set_project_mode` | — |
| Attest only as a producer, on an open gate declared `self` | `before_attestation` trigger | `42501` / `P0001` |
| One attestation per gate; never edited or deleted | unique key, `append_only` trigger | `23505` / `42501` |
| Signer, statement and time are set by the server; clients may insert only `project_id`, `stage_id` | trigger + column grants | `42501` |
| A self-mode gate takes no decision before its attestation | `before_decision` | `P0001` |
| Only a signed-in, non-anonymous person can attest or sign a gate, regardless of assigned role | `before_attestation`, `before_decision` | `42501` |

## Guest (anonymous) accounts

- A guest may hold project roles but cannot record a gate decision or a producer attestation.
- So a guest in a mandatory signing role can stop a gate from passing. For an `external` Gate 5,
  every required investor must be able to sign.
- The producer must remove or replace an ineligible guest signer before that gate can pass.
- A gate is evaluated only when a decision is recorded. Removing a member does not re-evaluate it, so
  a further valid decision may be needed before the gate passes (existing known limitation).

**Separate known gap (unchanged in this phase):** guests can still tick checklist items they are
authorised for (`gate roles tick checklists` checks role, not `is_anonymous`). A tick locks that
gate's project mode.

`statement` has `default ''` only so generated TypeScript lets a client insert `{ project_id, stage_id }`.
The trigger always replaces it with the canonical declaration, and `check (statement <> '')` rejects
any row where that did not happen.

## Retryable deadlocks (`40P01`)

`set_project_mode` locks the project, then the gate's checklist items in position order, then the
stage. A checklist tick locks its item and then the stage. A **multi-item** checklist update locks
items in whatever row order it scans, so it can lock item 2 before item 1 while a mode change holds
item 1 and waits for item 2. PostgreSQL detects the cycle and aborts one transaction with
`40P01 deadlock_detected`. The aborted transaction is rolled back completely: no mode change, no
tick, no audit event. Data stays consistent; only that request failed.

Guidance for future callers (no client retries exist yet; this phase is database-only):

1. Treat `40P01` (and `40001`) as retryable, every other error as final.
2. Before retrying, re-read the project's modes, the gate's status and its checklist. Retry only if
   the caller is still a producer and the change is still allowed (the gate has no progress yet).
   Otherwise surface the new state instead.
3. Retry a small, bounded number of times (for example 3) with a short randomized backoff.
