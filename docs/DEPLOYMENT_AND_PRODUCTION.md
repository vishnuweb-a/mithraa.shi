# Deployment and Production

## What the repo tells us

- **No host configuration is in the repo.** No `vercel.json`, `netlify.toml`, `Dockerfile` or
  `output: "export"`. None is needed for Vercel. A CI workflow (`.github/workflows/ci.yml`) was
  added later; it does not deploy.
- **Deployments exist outside the repo** (found 2026-10-24 via the public GitHub API):
  - The **former team's** project `bhawna1203s-projects/mithraa-shi` deployed the parent repo
    `pixawna/mithraa.shi` and serves `https://mithraa-shi.vercel.app`. That is not ours.
  - A **separate** Vercel project, `vishnus-projects-c4d53dca/mithraa-shi`, already deployed this
    fork's `main` (commit `77ea338`) on 2026-10-24 16:40 UTC. It is probably yours; confirm it.
- The full plan is in [VERCEL_DEPLOYMENT_READINESS.md](VERCEL_DEPLOYMENT_READINESS.md).

## How it can be deployed

The app needs a Node.js server because `/stages/[stage]` uses Partial Prerendering
(`cacheComponents`), so a plain static export is not the default path.

| Option | Steps |
| --- | --- |
| Vercel (simplest for Next 16) | Import the GitHub repo, framework preset Next.js, no env vars needed |
| Any Node host / container | `npm ci && npm run build && npm start` (set `PORT` as needed) |

No environment variables or secrets are needed in any of these.

## Releases and rollback

There is no release process. Recommended minimum when you take over:

1. Protect `main`; work on branches and merge via PR (see [CI_CD_WORKFLOW.md](CI_CD_WORKFLOW.md)).
2. CI (added) runs `npm ci`, `npm run typecheck`, `npm run lint`, `npm run build` and a route smoke test.
3. If hosted on Vercel: every PR gets a preview URL; roll back by promoting a previous
   deployment. On a Node host: tag releases (`git tag v0.1.0`) and redeploy the previous tag.

## Monitoring

None configured. For a demo, host-level logs are enough. Error tracking (e.g. Sentry) becomes
worthwhile once there is a backend.

*Nothing was deployed or changed on any host during this audit.*
