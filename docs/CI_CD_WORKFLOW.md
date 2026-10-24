# CI/CD Workflow

## Pipeline

```
feature branch → PR into vishnuweb-a/mithraa.shi:main
                   ├─ GitHub Actions "CI / verify"   (quality gate)
                   └─ Vercel Preview deployment       (manual check)
              → review → squash-merge → main
                   ├─ GitHub Actions "CI / verify"   (re-run on main)
                   └─ Vercel Production deployment
```

Every PR also needs an initial and a final Ponytail review and the owner's merge authorization. See
[DEVELOPMENT_REVIEW_POLICY.md](DEVELOPMENT_REVIEW_POLICY.md).

GitHub Actions only **checks**. It never deploys and holds no secrets. Deployment is done only by
the Vercel GitHub App installed on your account, so the only things that can deploy this repo are
the Vercel projects connected to it. Check that list in GitHub *Settings → Integrations* (see
[INDEPENDENT_REPOSITORY_SETUP.md](INDEPENDENT_REPOSITORY_SETUP.md)).

## The workflow: `.github/workflows/ci.yml`

Runs on every pull request and on pushes to `main`. One job, `verify`, on `ubuntu-latest`, Node 24,
read-only token, cancels superseded runs, 15-minute timeout.

| Step | Command | Fails when |
| --- | --- | --- |
| Install | `npm ci` | lockfile out of sync with `package.json` |
| Types | `npm run typecheck` (`next typegen && tsc --noEmit`) | any type error, including route types |
| Lint | `npm run lint` | any ESLint error |
| Build | `npm run build` | build or prerender error |
| Route smoke test | `next start`, then `curl` 18 URLs | any page not 200; `/stages/bogus` or `/does-not-exist` not 404 |

`next typegen` matters: `PageProps`/`LayoutProps` are generated types, and `next-env.d.ts` is
git-ignored. Without it, `tsc` on a fresh checkout would not see the route types.

### Verified locally

The exact steps ran on a clean copy of the repo (tracked plus new files only, fresh `npm ci`,
Node 24.18.0, Windows Git Bash). All exited 0, and the smoke test printed 16 × 200 and 2 × 404.
**It has not run on GitHub yet.** Its first real run happens when the branch is pushed.

`npm ci` prints `allow-scripts` warnings: npm 11 skips `unrs-resolver`'s postinstall until it is
approved. Lint and build pass regardless. Leave it unless lint starts failing on import resolution.

## Tests

There is no unit-test framework. The smoke test above covers the one server behaviour
(status codes). Everything else is client-side UI.

The browser checks in [FINAL_OWNERSHIP_READINESS.md](FINAL_OWNERSHIP_READINESS.md) were run with
`playwright-core` from a scratch folder against the installed Edge. They were **not** added to the
repo, to avoid a new dependency and a browser download in CI. Add `@playwright/test` with a few
specs when one of these becomes true:

- the BrainProvider rules (gate signing, role checks) start changing often, or
- a real backend arrives and server behaviour needs testing.

The first spec worth adding would cover gate signing as producer vs production manager, plus
state surviving a reload.

## Required setup on GitHub (manual)

1. Enable Actions on the fork (*Actions* tab → enable). Forks start disabled.
2. Push a branch and open a PR so `verify` runs once. Required checks can only be selected after
   they have run.
3. Branch protection on `main`: require PR, require `verify` (and `Vercel` once confirmed), block
   force pushes.

## Local equivalent before pushing

```bash
npm ci && npm run typecheck && npm run lint && npm run build
```
