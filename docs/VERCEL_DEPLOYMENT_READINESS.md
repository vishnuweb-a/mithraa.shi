# Vercel Deployment Readiness

*Prepared 2026-10-24. Nothing was deployed, linked or changed on Vercel.*

## Summary

The app deploys with Vercel's **standard Next.js integration, unchanged**. No `vercel.json`, no
custom server, no environment variables and no secrets are needed. Everything is prerendered at
build time. Only unknown `/stages/*` ids render on request (to produce the 404).

**Important discovery:** a Vercel project already deploys this fork. Commit `77ea338` on
`vishnuweb-a/mithraa.shi` has a successful Vercel status from
`https://vercel.com/vishnus-projects-c4d53dca/mithraa-shi/ECrhSEKHa49NLBZYogYNPfu1szxh`
(2026-10-24 16:40 UTC). That is a different scope from the former team's
`bhawna1203s-projects/mithraa-shi`, which serves `https://mithraa-shi.vercel.app`.

- If `vishnus-projects-c4d53dca` is **your** Vercel account, use that project. Apply the settings
  below to it instead of creating a second one (two projects on one repo means double deploys).
- If it is **not** yours, uninstall that Vercel app's access to your repo, then create a new
  project as in the runbook.
- Either way, **pushing to `main` will deploy to Production** as soon as you push, so don't push
  `main` until the settings are confirmed.

## A. Configuration audit

| Item | Finding |
| --- | --- |
| Framework | Next.js 16.4.2, App Router, Turbopack build, `cacheComponents` + `partialPrefetching` |
| Repo root | The git root **is** the app (`package.json` at the top level). Root Directory = `./` |
| Package manager | npm, `package-lock.json` v3. No other lockfiles in the repo. (A stray empty lockfile in the parent folder on this PC is outside the repo and irrelevant to Vercel.) |
| Node.js | `next` requires `>=20.9.0`. Verified locally on 24.18.0; CI uses 24 |
| Scripts | `build: next build`, `start: next start`. No custom server |
| Output | Default `.next`. No `output: "export"`/`standalone`. Not a static export: unknown stage ids render on request |
| Routes | 8 static pages, 9 prerendered `/stages/<id>` pages, `/_not-found`. Unknown `/stages/*` render on request and return 404 |
| Public assets | `public/*.svg` (template icons, unused by pages) and `public/media/README.md`. The 13 `/media/*.jpg` stills are **absent**, so they return 404 and the UI shows gradients by design |
| `vercel.json` | None, and none needed |
| Env vars | None read by the code. See [ENVIRONMENT_SETUP.md](ENVIRONMENT_SETUP.md) |
| External URLs | None at runtime. At build, `next/font/google` downloads Inter and Space Grotesk |
| Headers | `next.config.ts` sets nosniff, Referrer-Policy, X-Frame-Options; `X-Powered-By` off |

## B. Project configuration

| Setting | Value |
| --- | --- |
| Git repository | `vishnuweb-a/mithraa.shi` (your fork), **never** `pixawna/mithraa.shi` |
| Vercel scope | Your personal account or your own team. Not `bhawna1203s-projects` |
| Project name | e.g. `mithraa-shi` (the domain `mithraa-shi.vercel.app` is already taken by the former team, so Vercel will generate a different one) |
| Production branch | `main` |
| Framework preset | Next.js (auto-detected) |
| Root directory | `./` |
| Install command | Override to `npm ci` (uses the lockfile exactly; the default `npm install` also works) |
| Build command | default (`npm run build` → `next build`) |
| Output directory | default (leave empty) |
| Node.js version | **24.x** (matches local and CI) |
| Environment variables | **None.** Optional: `NEXT_TELEMETRY_DISABLED=1` for all environments |
| Preview deployments | On for every non-`main` branch and PR. Keep Vercel's default *Deployment Protection* (Vercel Authentication) on Previews |
| Production deployments | Automatic on merge to `main` |
| Domain | Generated `*.vercel.app`. Custom domain optional (see runbook step 8) |
| Rollback | Vercel *Instant Rollback* to the previous production deployment, then revert on `main` |

Do **not** copy any project ID, team ID, token, domain or `.vercel/` folder from the former team.
None exists in this repo; `.vercel` is git-ignored.

## C. Environment model

| Environment | Where | Trigger | Config |
| --- | --- | --- | --- |
| Local | `npm run dev` / `npm run build && npm start` | You | Optional `.env.local` (telemetry only). Port via `-p` |
| Preview | Vercel, unique URL per push | Push to any non-`main` branch / PR | None |
| Production | Vercel, production domain | Merge to `main` | None |

Each browser keeps its own demo state in `localStorage`, and each Vercel domain is a separate
origin, so Preview and Production never share state. There is no backend, so nothing else needs
separating.

## D. Readiness verification (local, 2026-10-24)

| Check | Result | Evidence |
| --- | --- | --- |
| TypeScript (`npm run typecheck`) | PASS | exit 0, both the working copy and a clean copy after `npm ci` |
| ESLint (`npm run lint`) | PASS | exit 0, no output |
| Production build (`npm run build`) | PASS | 20 static pages generated |
| Route statuses | PASS | 16 routes 200; `/stages/bogus`, `/does-not-exist` 404 |
| Asset loading | PASS (expected misses) | Only 4xx are the 8 missing `/media/*.jpg` and the intended 404 tests |
| Responsive layout | PASS | 1440/820/390 px: nav works, no horizontal scroll on 9 pages |
| Browser console | PASS (expected) | 0 page errors in normal use; console errors are only the `/media/*.jpg` 404s |
| Runtime behaviour + persistence | PASS | see [FINAL_OWNERSHIP_READINESS.md](FINAL_OWNERSHIP_READINESS.md#f-quality-verification) |
| Sensitive config disclosure | PASS | `.next/static` has no `process.env` refs, keys or tokens; no env files tracked |

### Can only be confirmed on a Vercel Preview

1. **The 404 for unknown stages.** It relies on `ensureStatic = "navigation"` and was verified with
   `next start`. Vercel serves Partial Prerendering from its own infrastructure, so check
   `curl -I https://<preview>/stages/bogus` returns 404.
2. The security headers from `next.config.ts` are present on Vercel responses.
3. Build on Vercel's Node 24 image, including the Google Fonts download.
4. The generated domain name, and that Deployment Protection is on for Previews.
5. Which Vercel account owns `vishnus-projects-c4d53dca`.

## E. Operator runbook

**Prerequisites:** admin on `vishnuweb-a/mithraa.shi`; a Vercel account you own; the onboarding
changes reviewed and committed on a branch (not yet pushed to `main`).

1. **Check for an existing project.** Log in to Vercel and open the deployment link above.
   - It opens, and the scope is yours: go to step 3 with that project.
   - It doesn't open: the project belongs to someone else. On GitHub, open *Settings →
     Applications → Vercel → Configure* and confirm it isn't installed on your account. If it is
     installed by someone else's integration, remove the repo from it. Then continue to step 2.
2. **Create the project.** *Add New → Project → Import Git Repository*. Install or configure the
   Vercel GitHub App on **your** account with *Only select repositories → mithraa.shi*. Pick
   `vishnuweb-a/mithraa.shi`.
3. **Apply settings** from table B (*Settings → Build & Deployment*, *Environment Variables*, *Git*).
   Set Node.js to 24.x and the install command to `npm ci`. Add no environment variables.
4. **Deploy a Preview first.** Push the onboarding branch and open a PR into
   `vishnuweb-a/mithraa.shi:main`. Wait for the CI `verify` job and the Vercel Preview.
5. **Validate the Preview:**
   ```bash
   P=https://<preview-url>
   for p in / /desk /agents /pipeline /guardians /brain /roles /stages/prep /stages/release; do curl -s -o /dev/null -w "%{http_code} $p\n" "$P$p"; done
   curl -s -o /dev/null -w "%{http_code} /stages/bogus (want 404)\n" "$P/stages/bogus"
   curl -sI "$P/" | grep -iE "x-frame|x-content|referrer|x-powered"
   ```
   If Deployment Protection is on, run these in a logged-in browser or with a *Protection Bypass*
   token instead of curl. Then click through README's "Try this" list on the Preview.
6. **Promote.** Merge the PR (squash). Vercel builds `main` to Production. Re-run step 5 against
   the production URL.
7. **Update GitHub.** Set the repo *Website* field to your production URL. Add `Vercel` as a
   required status check on `main`.
8. **Optional custom domain.** *Settings → Domains → Add*. At your registrar, create the records
   Vercel shows (typically a CNAME to Vercel for a subdomain, or an A record for an apex). Wait
   for verification and HTTPS.

### Rollback

1. Vercel → *Deployments* → pick the last good production deployment → *Instant Rollback*
   (or `vercel rollback <deployment-url>` with the Vercel CLI). This takes seconds and does not rebuild.
2. Fix forward with `git revert <bad-sha>` on a branch → PR → merge. Instant Rollback pauses
   auto-promotion of new `main` builds until you undo it in the dashboard.

### Basic monitoring

- **Deployments tab:** build status and build logs for every push.
- **Logs / Runtime Logs:** request logs, including the on-demand renders of unknown stage ids.
- **Observability** tab: errors and request metrics, depending on your plan.
- **Web Analytics / Speed Insights** (optional): turned on in the dashboard, but they need a
  package and code change, so do that in a separate PR.
- **Notifications:** turn on failed-deployment emails in your Vercel account settings.
- GitHub sends CI failure emails to the PR author by default.
