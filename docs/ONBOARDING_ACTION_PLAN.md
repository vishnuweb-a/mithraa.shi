# Onboarding Action Plan

## Day 1 — confirm ownership

1. [ ] Install GitHub CLI and confirm admin access to **your fork**: `gh repo view vishnuweb-a/mithraa.shi --json viewerPermission`.
       (`vishnuweb-a/mithraa.shi` is a fork of `pixawna/mithraa.shi`; see [INDEPENDENT_REPOSITORY_SETUP.md](INDEPENDENT_REPOSITORY_SETUP.md).)
2. [ ] Request the **Agentic Pipeline & Dashboard Blueprint** from the previous team.
3. [x] Live deployment found: the former team's `https://mithraa-shi.vercel.app`. **Do not** ask to join that project.
       Confirm that `vishnus-projects-c4d53dca/mithraa-shi` is your own Vercel project ([VERCEL_DEPLOYMENT_READINESS.md](VERCEL_DEPLOYMENT_READINESS.md)).
4. [ ] Send the 7 questions in [OWNERSHIP_HANDOVER.md](OWNERSHIP_HANDOVER.md#undocumented-knowledge-to-ask-the-previous-team-about).

## Day 1 — run it yourself

5. [ ] `cd mithraa.shi && npm run dev`, then walk through the "Try this" list in `README.md`.
6. [ ] Review and commit this handover: `docs/`, `.env.example`, and the one-line `.gitignore` change.
       (`.env.local` stays uncommitted.)
7. [ ] Optional: delete the empty `filmMaker/package-lock.json` outside the repo to silence the build warning.

## Week 1 — basic hygiene

8. [ ] Protect `main` and require PRs.
9. [x] CI workflow added (`.github/workflows/ci.yml`). Make it a required check once it has run on GitHub.
10. [x] `typecheck` script added (`next typegen && tsc --noEmit`).
11. [ ] Apply patch updates together (`next`/`eslint-config-next` 16.4.3, `react`/`react-dom` 19.3.1), then re-validate.
12. [x] `poweredByHeader: false` and three basic headers added. A CSP is still open.
13. [ ] Add rights-cleared stills to `public/media/`.

## After the Blueprint arrives — decide direction

14. [ ] Decide whether this stays a demo or becomes the real product.
15. [ ] If it becomes the real product: design the backend (auth, Project Brain DB from `lib/data.ts` types, agent runtime, AI provider), then add its env vars to `.env.example` as you add the code.
