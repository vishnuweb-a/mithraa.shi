# Project Ownership and Independence

*What this project needs to run without the former team. Status as of 2026-10-24.*

Status key: **Done** · **Action** (you need to do it) · **Blocked** (needs someone else) · **Unconfirmed**

## 1. Legal and licensing (check first)

| Item | Status | Notes |
| --- | --- | --- |
| Code licence | **Blocked** | No `LICENSE` file in this repo, and GitHub reports `license: null` on `pixawna/mithraa.shi`. Without a licence, the original authors keep all rights by default; a public fork alone does not grant a right to maintain, modify or deploy it as your own product. **Get written permission or a licence (e.g. MIT) from the owner of `pixawna/mithraa.shi`** before deploying it publicly as an independent project. *This is a practical flag, not legal advice.* |
| Attribution | Done | Git history and the author (`Bhawna🤖`) are preserved. Keep them. |
| Fonts | OK | Inter and Space Grotesk via `next/font/google` (SIL Open Font Licence). |
| Template icons `public/*.svg` | OK | `create-next-app` defaults; not used by any page. |
| Film stills `public/media/*.jpg` | **Blocked** | None in the repo. Any added image needs a documented licence. |
| Design references | Note | Comments in `app/globals.css` and `app/layout.tsx` say the look is "Higgsfield-matched". Only colours and the font pairing are matched, and no Higgsfield assets are present. Avoid copying that product's branding further. |

## 2. GitHub administration

| Requirement | Status |
| --- | --- |
| Admin on `vishnuweb-a/mithraa.shi` | **Unconfirmed**: run `gh repo view vishnuweb-a/mithraa.shi --json viewerPermission` |
| Fork of `pixawna/mithraa.shi` | Documented. Detaching is optional ([INDEPENDENT_REPOSITORY_SETUP.md](INDEPENDENT_REPOSITORY_SETUP.md)) |
| Website field points to former team's URL | **Action**: clear or replace it |
| Actions enabled on the fork | **Action** |
| Branch protection on `main` | **Action**: currently none |
| Collaborators / repository access | **Action**: review *Settings → Collaborators*; keep write/admin to yourself and named maintainers |
| Installed GitHub Apps (Vercel etc.) | **Action**: confirm each one was installed by you |

## 3. Vercel ownership and deployment identity

| Requirement | Status |
| --- | --- |
| Vercel account/team you own | **Unconfirmed**: a project in scope `vishnus-projects-c4d53dca` already deploys this fork. Confirm it is yours |
| Former team's project `bhawna1203s-projects/mithraa-shi` | Not used. Do not request access or link it. It deploys `pixawna/mithraa.shi`, not your fork |
| Project name / domain | `mithraa-shi.vercel.app` belongs to the former team. Yours will be a different generated domain |
| Custom domain | None today. Optional; if added, register it in **your** registrar account |
| Who can deploy | Anyone who can merge to `main` (auto production deploy) or who is a member of your Vercel scope (manual redeploys) |
| Who can roll back | Members of your Vercel scope with deploy rights (*Instant Rollback*) |
| Deployment tokens | None exist or are needed. Do not create a `VERCEL_TOKEN` for CI; the Git integration deploys |

**Brand overlap:** the former team's site at `mithraa-shi.vercel.app` shows the same product under
the same name. Agree with them on whether both stay online, and on who may use the
"mithraa.SHI" name.

## 4. Monitoring and logs

Vercel *Deployments* (build logs), *Logs* (runtime) and failed-deployment notifications, plus
GitHub Actions results on each PR. There is no backend, so there is nothing else to monitor.
Details are in [VERCEL_DEPLOYMENT_READINESS.md](VERCEL_DEPLOYMENT_READINESS.md#basic-monitoring).

## 5. Documentation and product ownership

| Item | Owner | Status |
| --- | --- | --- |
| `docs/` (16 files) and `README.md` | Repo maintainer (you) | Done; update in the same PR as any behaviour change |
| `AGENTS.md` | Written by `next dev` | Leave as is |
| Product specification | You, once received | **Blocked**, see section 6 |
| Sample data `lib/data.ts` | Repo maintainer | Illustrative only; not a spec |

## 6. The "Agentic Pipeline & Dashboard Blueprint"

- **Referenced in:** `README.md` line 3 ("built from the Agentic Pipeline & Dashboard Blueprint")
  and line 23 ("the stage's dashboard panels from the blueprint"). Nowhere else in the repo,
  history, issues or docs.
- **Available:** **No.** Not in the repo, and not linked from either GitHub repo.
- **Treatment:** an outstanding requirement. The prototype's 9 stages, 44 agents, 7 guardians,
  gate rules and role views are *what the prototype shows*. They have not been confirmed as what
  the Blueprint specifies, and no product requirements have been inferred from the document's
  name.
- **To obtain:** from the owner of `pixawna/mithraa.shi` (Vercel scope `bhawna1203s-projects`),
  together with the licence in section 1.

## 7. Functionality status

| Area | Status |
| --- | --- |
| 17 screens, navigation, responsive layout | **Implemented** (verified in a browser) |
| Role switching, gate ticking/signing, approvals, flags, notes, audit log | **Implemented as client-side simulation**. Not access control |
| Stage 1 "agent run", per-agent sample runs | **Simulated** (timers plus a deterministic text heuristic) |
| Ask SHI | **Simulated** (keyword matching to canned answers) |
| Persistence | **Implemented**, per browser (`localStorage`); crashes on malformed saved data |
| Real AI agents, Project Brain database, auth, multi-user, spend caps | **Planned (per README/code comments), not built, unconfirmed by any spec** |
| Film stills | **Missing** |

## 8. Remaining former-team dependencies

| Dependency | Impact | Resolution |
| --- | --- | --- |
| Licence / permission | Blocks legitimate independent deployment | Obtain in writing |
| Blueprint document | Blocks product work beyond the prototype | Obtain |
| GitHub fork link to `pixawna/mithraa.shi` | Cosmetic; PRs default to the parent | Pick the base repo carefully, or detach |
| Website field → `mithraa-shi.vercel.app` | Sends visitors to their deployment | Change it |
| Their live deployment and the shared name | Confusion over which site is official | Agree with them |
| Runtime, build, credentials | **None.** The app has no dependency on their accounts | — |
