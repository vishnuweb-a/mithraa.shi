# Final Ownership Readiness

*2026-10-24 · branch `main` @ `77ea338` plus uncommitted changes · Next.js 16.4.2 · Node 24.18.0 / npm 11.16.0 · Windows 11.
Nothing was committed, pushed, merged or deployed.*

## A. Repository status

A **frontend-only Next.js 16 prototype** (App Router, React 19.3, Tailwind 4, TypeScript 5.9;
about 5,760 source lines). It has 17 screens (8 pages plus 9 stage dashboards) that walk a sample film
through 9 gated stages. All agents, AI answers and permissions are simulated in the browser.
State lives in `localStorage`. There is no backend, database, auth, AI provider or outbound
network call. Details: [REPOSITORY_OVERVIEW.md](REPOSITORY_OVERVIEW.md), [ARCHITECTURE.md](ARCHITECTURE.md).

## B. Changes made (all uncommitted)

| File | Change |
| --- | --- |
| `app/stages/[stage]/page.tsx` | `export const ensureStatic = "navigation"`, so unknown stage ids return HTTP **404** instead of 200 (see G1) |
| `next.config.ts` | `poweredByHeader: false`; `headers()` adds `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`. CSP deferred (marked `shortcut:`) |
| `package.json` | New script `typecheck: next typegen && tsc --noEmit` |
| `.github/workflows/ci.yml` | **New.** CI: `npm ci` → typecheck → lint → build → route smoke test (200s and 404s) |
| `.env.example` | **New in git** (from earlier onboarding). Removed misleading `PORT`; documented verified behaviour and "no Vercel vars needed" |
| `.env.local` | Removed `PORT` (git-ignored, not committed) |
| `.gitignore` | `!.env.example` (from earlier onboarding) |
| `README.md` | One "Prototype: everything is simulated" note with a link to `docs/` |
| `docs/` 11 existing files | Minimal corrections; see section "Documentation corrections" below |
| `docs/INDEPENDENT_REPOSITORY_SETUP.md` | **New.** Remotes, fork relationship, GitHub settings, branch/PR workflow |
| `docs/VERCEL_DEPLOYMENT_READINESS.md` | **New.** Config audit, project settings, environments, runbook, rollback, monitoring |
| `docs/CI_CD_WORKFLOW.md` | **New.** Pipeline and quality gates |
| `docs/PROJECT_OWNERSHIP_AND_INDEPENDENCE.md` | **New.** Licence, access, Vercel identity, Blueprint, former-team dependencies |
| `docs/FINAL_OWNERSHIP_READINESS.md` | **New.** This report |

No dependencies were added. No business logic was changed. Test tooling (`playwright-core`) was
installed only in a scratch folder outside the repo.

### Documentation corrections

| Doc | What was wrong or out of date | Fix |
| --- | --- | --- |
| ENVIRONMENT_SETUP | Listed `PORT` as a dotenv variable; telemetry claim unverified; no Vercel section; said `.env.example` was already tracked | Removed `PORT` and added verified behaviour; Vercel needs no vars; tracking status corrected |
| LOCAL_DEVELOPMENT_GUIDE | `/stages/bogus` 200 marked PASS; browser NOT RUN; no typecheck script | Updated to the fix, the new script, and the browser results |
| DEPLOYMENT_AND_PRODUCTION | "Whether a live deployment exists is unknown" | Both Vercel deployments documented |
| REPOSITORY_OVERVIEW | Did not mention that `origin` is a fork; "no CI" | Fork parent and CI added |
| REQUIRED_ACCESS_AND_CREDENTIALS | Hosting row pointed to "previous team" access; domain marked important | Now **your own** Vercel; former project explicitly not needed; domain optional |
| SECURITY_AUDIT | localStorage risk theoretical; headers open; no inherited-infra finding | Crash reproduced; headers partly fixed; finding #6 added |
| ONBOARDING_ACTION_PLAN, OWNERSHIP_HANDOVER | "Nothing broken"; open items now done | Updated status and links |
| ARCHITECTURE, DATABASE_AND_API_ANALYSIS, THIRD_PARTY_INTEGRATIONS | No 404 mechanism, headers, CI or Vercel | Added |

No doc claimed real AI, a backend or production authorization. The existing docs already
labelled these as simulated, and that was kept.

## C. Environment configuration

- **Required variables: none**, locally or on Vercel (Preview and Production).
- **Verified:** `NEXT_TELEMETRY_DISABLED` is honoured from `.env.local` (dotenv loads before the
  telemetry client; `isDisabled === true`). `PORT` in `.env.local` is **ignored** (servers stayed on
  3000); use `-p` or a shell variable.
- `.env.example` is not ignored and will be tracked on the next commit. `.env`, `.env.local`,
  `.env.production.local` are ignored (`git check-ignore -v`).
- No secrets in client bundles: `.next/static` has no `process.env` references, keys or tokens.
- **Missing configuration:** none.

## D. Independent ownership

- `origin` = `vishnuweb-a/mithraa.shi`, a GitHub **fork of `pixawna/mithraa.shi`**. No `upstream`.
  Remotes were not changed.
- `main` has **no branch protection**. Your permission level is **unverified** (no `gh` or token).
- **Vercel:** your fork is already deployed by `vishnus-projects-c4d53dca/mithraa-shi`
  (successful at 2026-10-24 16:40 UTC). The former team's `bhawna1203s-projects/mithraa-shi` serves
  `mithraa-shi.vercel.app` from the parent repo.
- The fork's GitHub *Website* field points to the former team's URL.
- The code has no former-team URLs, IDs or credentials.
- **Unresolved:** licence/permission; the Blueprint; confirmation that `vishnuweb-a` and
  `vishnus-projects-c4d53dca` are yours; how the two live sites should coexist.

## E. Vercel deployment readiness

Standard Next.js integration with **no `vercel.json` and no env vars**: repo `vishnuweb-a/mithraa.shi`,
production branch `main`, root `./`, install `npm ci`, default build/output, Node **24.x**, Preview
for all other branches with Deployment Protection on. Full runbook:
[VERCEL_DEPLOYMENT_READINESS.md](VERCEL_DEPLOYMENT_READINESS.md).

**Blockers:**

1. Confirm ownership of the existing Vercel project. A push to `main` deploys to it straight away.
2. Licence or permission from the original owner before presenting it publicly as an independent product.

**Verify on the first Preview:** 404 for `/stages/bogus` on Vercel's infrastructure, the headers, and the Node 24 build.

## F. Quality verification

| # | Check | Command / method | Status | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Install from lockfile | `npm ci` (clean copy) | PASS | completed; `allow-scripts` warning for `unrs-resolver` postinstall |
| 2 | TypeScript | `npm run typecheck` | PASS | exit 0 (working copy and clean copy) |
| 3 | ESLint | `npm run lint` | PASS | exit 0, no output |
| 4 | Production build | `npm run build` | PASS | exit 0, 20/20 static pages |
| 5 | Route smoke test (CI script, verbatim) | `bash` on clean copy | PASS | 16 × 200, `/stages/bogus` 404, `/does-not-exist` 404 |
| 6 | Unknown stage status before fix | `curl` on `next start` | FAIL → fixed | was `200` + `noindex`; after fix `404` (two requests, same result) |
| 7 | Security headers | `curl -I /` | PASS | nosniff, Referrer-Policy, X-Frame-Options present; no `X-Powered-By` |
| 8 | Dependency audit | `npm audit` | PASS | 0 vulnerabilities (prod and dev) |
| 9 | Bundle secret scan | `grep` `.next/static` | PASS | no env reads, key or token patterns |
| 10 | Telemetry from `.env.local` | Next source + `Telemetry.isDisabled` | PASS | `true` |
| 11 | `PORT` from `.env.local` | `next start`, `next dev` | Confirmed ignored | both on 3000 |
| B1 | Homepage + sidebar navigation | Playwright (Edge, headless), 1440 px | PASS | 7 links: URL and heading verified |
| B2 | Stage navigation | stage tabs on `/stages/prep` | PASS | ideate, write, post, release, prep reached |
| B3 | Role switching | sidebar select → Production Manager | PASS | desk link shows "Ops Board"; stored `role: "pm"`; audit "signed in" |
| B4a | Gate refuses wrong role | PM ticks Gate 6 | PASS | toast "Only the Producer, Director, Costume HOD can tick Gate 6."; sign disabled |
| B4b | Gate sign | Producer ticks 4 items → Sign | PASS | toast "Gate 6 signed. Production is open…"; chip "Signed" |
| B5a | Simulated Stage 1 agents | Studio prompt → Run agents → Greenlight | PASS | toast "Night Frequency greenlit…" |
| B5b | Simulated single agent | Agents → Idea Capture → Run → Accept | PASS | button → "Run again"; draft accepted |
| B6 | Ask SHI | Ctrl+K "what's blocking the gate?" → Enter | PASS | "Gate 7, Picture Wrap: 3 items still open" → `/stages/production#gate` |
| B7 | localStorage persistence | read `mithraa-shi-brain-v1` | PASS | `passed.prep = "24 Oct"` |
| B8 | Refresh restores state | reload | PASS | Gate 6 still signed; sidebar "Waiting at Gate 7" |
| B7b | Reset | "Reset sample data" | PASS | seed restored |
| B9 | Invalid routes in browser | `/stages/bogus`, `/does-not-exist` | PASS | both 404 with the not-found page |
| B10 | Responsive | 1440 / 820 / 390 px, 9 pages each | PASS | correct nav visible and working; no horizontal scroll |
| B11 | Console / page errors (normal use) | listeners across the run | PASS | 0 page errors; console errors are only `/media/*.jpg` 404s |
| B12 | Malformed localStorage | set `{"checks":null,"audit":"x"}`, open `/brain`, `/stages/prep`, `/desk` | **FAIL** | crash screen on all three (see G2) |
| — | Unit tests | — | NOT RUN | none exist |
| — | GitHub Actions run | — | NOT RUN | not pushed |
| — | Vercel Preview | — | BLOCKED | needs your Vercel confirmation and approval |

The browser suite ran three times. Results were identical, except that B6 timed out once when Ctrl+K
was pressed before hydration; the test now waits for network idle. Script:
`C:\Users\Coder\AppData\Local\Temp\claude\c--Users-Coder-Desktop-filmMaker\c6839763-2002-4b7a-bb17-f7a088b75ab5\scratchpad\pw\e2e.js` (scratch; not in the repo).

## G. Known issues

**Bugs**

1. *(Fixed)* `/stages/<unknown>` returned **HTTP 200**. Cause, verified against the installed
   Next 16.4.2 docs: with `cacheComponents` + `partialPrefetching`, an unlisted param is served
   the route's prerendered **fallback shell** (Next ≥ 16.3), which commits a `200` before the page's
   `notFound()` runs. Next then can only inject `noindex`. The page code itself was correct, and
   `dynamicParams = false` is rejected under Cache Components. Fix: `ensureStatic = "navigation"`
   makes Next finish rendering before responding. Effect on valid stages: none (still 200 and static).
2. Malformed or outdated `localStorage` crashes three screens, and the in-app Reset can't be reached
   from the error screen. Fix suggested, not applied (small type check on the saved fields).
3. The Ctrl+K shortcut does nothing until the page hydrates (a fraction of a second). Minor.
4. 13 film stills missing (gradient fallback by design).

**Security** (full table: [SECURITY_AUDIT.md](SECURITY_AUDIT.md))

- Medium: role and gate rules are client-side only. Fine for a demo, but not access control.
- Medium (operational): inherited deployment identity (Website field, unconfirmed Vercel scope).
- Low: no CSP; localStorage not validated (bug 2).

**Technical debt:** no unit or browser tests in the repo; hardcoded `TODAY` and timeline bounds;
unused `Still` props; `npm ci` `allow-scripts` warning; patch updates available
(`next` 16.4.3, `react` 19.3.1). These were not applied in this pass.

## H. External access and information needed

| Priority | Item | From |
| --- | --- | --- |
| 1 | Written licence/permission to maintain and deploy the code | Owner of `pixawna/mithraa.shi` |
| 2 | Confirm `vishnus-projects-c4d53dca` is your Vercel scope (open the status link logged in) | You |
| 3 | Confirm admin on `vishnuweb-a/mithraa.shi` (`gh repo view … --json viewerPermission`) | You |
| 4 | The "Agentic Pipeline & Dashboard Blueprint" | Former team |
| 5 | Agreement on the name and the former team's live `mithraa-shi.vercel.app` | Former team |
| 6 | Rights-cleared film stills | Former team / photographer |
| 7 | Design source files (Figma etc.), if any | Former team |
| 8 | Custom domain decision | You (optional) |

## I. Ownership readiness

| Dimension | Status | Why |
| --- | --- | --- |
| **Development** | **Ready** | Builds, lints and type-checks on a clean install; local workflow and CI documented; changes are small and verified |
| **Deployment** | **Ready after 2 confirmations** | Technically deployable unchanged. Waiting on you to confirm the Vercel project owner, then a validated Preview. The licence should be settled before a public launch |
| **Production operations** | **Not ready** | No branch protection, CI not yet run on GitHub, no CSP, no monitoring alerts set, localStorage crash unfixed. All are small, but none is done |
| **Product completion** | **Prototype only** | All intelligence, data and permissions are simulated; the Blueprint that defines the real product is missing |

## J. Next development phase

1. **Approve and commit** this onboarding on a branch (`chore/independent-onboarding`), push, and open a PR into
   **your** fork. CI runs, and Vercel builds a Preview.
2. Do the runbook's Preview checks, especially the 404. Merge, then set branch protection with `verify` required.
3. Small fix PR: validate saved `localStorage` fields in `BrainProvider` (bug 2), plus one browser test for it.
4. Patch updates (`next`/`eslint-config-next` 16.4.3, `react`/`react-dom` 19.3.1) in their own PR, with CI as the gate.
5. Add a CSP once tested against a Vercel Preview.
6. **Stop before backend work** until the Blueprint and licence arrive. Then decide demo vs. product,
   and design the backend from the confirmed spec, not from the prototype's sample data.
