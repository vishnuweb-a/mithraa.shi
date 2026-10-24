# Development Review Policy

Applies to every feature, bug-fix, database, authentication, AI-agent and infrastructure pull request.

## Workflow

**Implement → Ponytail review → Fix → Tests → Ponytail re-review → GitHub CI → Owner approval**

| Step | Requirement |
| --- | --- |
| Initial review | Run `/ponytail-review` against the **complete PR diff vs `main`**, not only uncommitted changes. Use `/ponytail full` by default, and `/ponytail ultra` where supported for database, auth, security, payment or orchestration changes. |
| Verify findings | Reproduce each finding against the code or a local database before acting on it. Unverifiable findings are dropped and noted. |
| Fix | Fix every blocking (Critical/High, or "Must fix") finding. Each confirmed defect gets a regression test that fails on the old code. |
| Tests | The automated tests that fit the change: pgTAP (`npm run db:test`), race tests (`supabase/tests/concurrency.sh`), typecheck, lint, build, route smoke test. |
| Final review | Run `/ponytail-review` again on the complete intended diff. Earlier findings are either resolved or explicitly accepted with a reason. |
| CI | `verify` and `db-test` pass on the PR's latest head SHA. |
| Disclosure | The PR description lists remaining risks and accepted findings. |
| Merge | Only the project owner authorizes a merge. |

## What Ponytail is and is not

Ponytail is an AI code review. It does not replace automated tests, and it is **not** a formal
independent human approval on GitHub. A PR is ready to merge only when the AI review, the tests, CI
and the owner's approval all agree.

Never claim a Ponytail review ran unless its output is recorded (in the PR or a review doc such as
[PHASE_1A_FINAL_SECURITY_REVIEW.md](PHASE_1A_FINAL_SECURITY_REVIEW.md)).
