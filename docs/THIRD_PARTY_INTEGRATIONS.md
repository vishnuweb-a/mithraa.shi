# Third-Party Integrations

## Runtime integrations — none

No payments, email, SMS, AI/LLM providers, analytics, cloud storage, auth providers or
webhooks are used. Searching the source for `fetch(`, `axios`, `http(s)://` found no
outbound calls. No callback URLs, webhook verification or reconciliation logic exist.

Features that *look like* integrations are local simulations:

| UI feature | What actually runs |
| --- | --- |
| "Run agents" on Studio | `useRun` timer + `runIdeaAgents()` text heuristic (`components/studio/`) |
| Ask SHI (⌘K) | Keyword match to canned answers (`AskShi` in `components/shell/Topbar.tsx`) |
| Agent "run a sample" | Static text from `lib/data.ts` |
| Agent spend caps | Display numbers in `lib/data.ts` |
| Market / trend / IP scores | Hash-based pseudo-random numbers |

## Build-time dependency

| Service | Used for | Entry point | Credentials | If unavailable |
| --- | --- | --- | --- | --- |
| Google Fonts (via `next/font/google`) | Inter and Space Grotesk, self-hosted after download | `app/layout.tsx` | None | `next build` / first `next dev` fails or falls back without network |

## Hosting and CI (outside the app code)

| Service | Used for | Configured where | Credentials in repo |
| --- | --- | --- | --- |
| Vercel | Hosting via the Vercel GitHub integration | Vercel dashboard (no `vercel.json`) | None |
| GitHub Actions | CI checks (`.github/workflows/ci.yml`) | Repo | None; uses only the default read-only `GITHUB_TOKEN` |

## npm packages

Runtime: `next@16.4.2`, `react@19.3.0`, `react-dom@19.3.0`. Dev: `tailwindcss@4`,
`@tailwindcss/turbopack@4`, `typescript@5`, `eslint@9`, `eslint-config-next@16.4.2`,
`@types/*`. `npm audit`: 0 vulnerabilities (2026-10-24).

Available patch updates (not applied): `next` 16.4.3, `eslint-config-next` 16.4.3,
`react`/`react-dom` 19.3.1. Major versions (`eslint` 10, `typescript` 7, `@types/node` 26)
would need testing. Apply the patches together, then re-run lint, type check and build.
