# Supabase Integration Status

*Verified 2026-10-25 on branch `feat/project-brain-foundation`. Supabase CLI 2.115.0, Docker 29.6.1.*

## Environments

| Environment | Status | Used for |
| --- | --- | --- |
| **Local stack** (`supabase start`, Postgres 17) | **Working.** Migration applied, tests pass | All Phase 1A development and testing |
| **Remote project** (ref `yzdq…`, from `.mcp.json` and `.env`) | Reachable. Nothing marks it as dev or prod. Read-only probe: `public` exposes **no tables**, email sign-up on, anonymous sign-ins off | **Nothing.** No migration pushed and no writes |
| Supabase MCP server (`.mcp.json`, HTTP, local config, not committed) | Authenticated later on 2026-10-25. Read-only calls only: no tables, no migrations, no branches | Read-only checks. Never `apply_migration` |
| **CI** (`db-test` job in `.github/workflows/ci.yml`) | Starts a throwaway local stack in Docker on the runner and runs `supabase test db --local` | All pgTAP assertions on every PR. No link, no secrets, no remote access |

Before anything reaches the remote project, the owner should confirm it is a **development**
project. Ideally keep a separate production project and link with `supabase link`. Then run
`supabase db push --dry-run` and review it. Do not apply schema through MCP `apply_migration`.

## Environment variables

| Name | Where | Read by | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `.env.local` | `lib/supabase/{client,server}.ts` | **Not yet set.** Existing `.env` uses `SUPABASE_URL`, which the browser cannot read |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `.env.local` | same | Publishable key only |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_ANON_KEY` | `.env` (local, git-ignored) | nothing in the app | Pre-existing |
| `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | `.env` (local, git-ignored) | **nothing.** Must never get a `NEXT_PUBLIC_` prefix | Bypass RLS. Keep server-only. Consider removing them from the dev machine until a server task needs them |

No env file was modified. `.env.example` documents the two new names with placeholders.

## Next.js integration

- `@supabase/supabase-js@2.117.3` and `@supabase/ssr@0.12.7`, pinned exactly. Both were published more than two weeks before install.
- `lib/supabase/client.ts`: browser client. `lib/supabase/server.ts`: per-request server client using the async `cookies()` from Next 16.
- `lib/supabase/database.types.ts`: generated from the local schema (`npm run db:types`).
- **Not wired to any screen.** `BrainProvider` and the sample data are unchanged. No `proxy.ts` yet; it is needed only once sign-in exists.

## Supabase resources used

Local only: Postgres, GoTrue (Auth), PostgREST, Kong. Realtime, Storage, Studio, Edge Functions,
logging and pooler were excluded from `supabase start`. Remote: none.

## Commands

```bash
supabase start -x realtime,storage-api,imgproxy,mailpit,studio,edge-runtime,logflare,vector,supavisor,postgres-meta
supabase db reset --local   # applies supabase/migrations
npm run db:test             # pgTAP: supabase/tests
npm run db:types            # regenerate lib/supabase/database.types.ts
supabase db advisors --local
```

## Blockers and gaps

1. The remote project's role (dev or prod) is unconfirmed. Push nothing until it is.
2. `model_pipeline.pdf` and `bussiness_model.pdf` are outside the repo (in the owner's Downloads folder). The gate rules on pp. 3–12 were checked against the default policy and match it, apart from the Gate 4 note in the architecture doc.
3. CI runs the DB tests with Supabase CLI 2.115.0, matching local. Bump both together.
4. Before any screen writes decisions: HOD department per signature (R1) and the solo self-financed / self-distributed path (R2). See architecture doc §4a.
