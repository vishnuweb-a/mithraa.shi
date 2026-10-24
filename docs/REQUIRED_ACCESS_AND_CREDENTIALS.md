# Required Access and Credentials

Because the app has no backend or integrations, **no API keys or service credentials are
needed to run it**. What you need is ownership of the code, the design intent, and whatever
hosting exists outside this repo.

Status key: **Available** = verified in this session · **Missing** = known gap · **Unknown** = cannot be verified from the repo.

| # | Resource | Purpose | Priority | Env | Where to obtain | Status | How to verify |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | GitHub repo `vishnuweb-a/mithraa.shi` — admin/write | Own the code, push, manage settings | Critical | All | You, if `vishnuweb-a` is your account (it is a fork of `pixawna/mithraa.shi`) | **Unknown** — public API confirms the fork exists; `gh` CLI not installed and no token used, so permission level not checked | `gh repo view vishnuweb-a/mithraa.shi --json viewerPermission` (expect `ADMIN`) |
| 2 | "Agentic Pipeline & Dashboard Blueprint" | Source spec for the 9 stages, 44 agents, 7 guardians; needed before building real features | Critical | — | Previous team | **Missing** — referenced in `README.md`, not in repo | You have the document |
| 3 | **Your own** Vercel account/project | Host this fork independently | Critical | Preview, Prod | You | **Unconfirmed** — a project `vishnus-projects-c4d53dca/mithraa-shi` already posted a successful deployment status on this fork. The former team's project (`bhawna1203s-projects/mithraa-shi`, `mithraa-shi.vercel.app`) is **not** needed and must not be reused | Open the status link in [VERCEL_DEPLOYMENT_READINESS.md](VERCEL_DEPLOYMENT_READINESS.md) while logged in |
| 4 | Domain / DNS (optional) | A custom URL for your deployment | Optional | Prod | Your registrar | **Not needed** — no custom domain is referenced anywhere; the former team uses only a `*.vercel.app` URL | Registrar account shows the domain |
| 5 | Rights-cleared stills for `public/media/` (13 JPGs) | Replace gradient placeholders | Optional | All | Previous team or design/photo owner | **Missing** — none are in the repo (`/media/kolam.jpg` → 404) | Files present; licence confirmed |
| 6 | Product/design files (Figma etc.) | Visual source of truth | Optional | — | Previous team | **Unknown** | Access granted |
| 7 | Decision log / context on "Bhawna🤖" commits | Understand how the code was produced (author name suggests an AI agent) | Optional | — | Previous team | **Unknown** | Written answer |

## Not needed today (no code uses them)

Database, cloud storage, OAuth, SMTP/email, SMS/WhatsApp, payment gateways, webhook
secrets, AI/LLM keys, monitoring/logging, CI/CD variables, App Store / Play Console.
Each of these is **not applicable** until the matching feature is built.

## Can be generated locally

`.env.local` (done), any future dev-only secrets (e.g. `openssl rand -base64 32`), a local
Postgres for future backend work. Nothing here needs to come from the old owner.
