# Local Development Guide

## Prerequisites

- Node.js **≥ 20.9** (Next 16 `engines`). Verified with Node 24.18.0 / npm 11.16.0 on Windows 11.
- Internet access on first build: `next/font/google` downloads Inter and Space Grotesk.

## Commands

Run all commands inside `mithraa.shi/`.

| Step | Command | Notes |
| --- | --- | --- |
| Install | `npm ci` | Uses the lockfile exactly. (`node_modules` was already installed; not re-run.) |
| Env | none required | Optional: edit `.env.local` (see [ENVIRONMENT_SETUP.md](ENVIRONMENT_SETUP.md)) |
| Infrastructure / DB / migrations | not applicable | No database |
| Dev server | `npm run dev` → http://localhost:3000 | Turbopack; regenerates `AGENTS.md` and `next-env.d.ts` |
| Type check | `npm run typecheck` | Runs `next typegen` first so route types exist on a fresh clone |
| Lint | `npm run lint` | ESLint 9 flat config, `eslint-config-next` |
| Tests | CI route smoke test | No unit-test framework. CI checks 16 routes return 200 and unknown routes return 404 (see [CI_CD_WORKFLOW.md](CI_CD_WORKFLOW.md)) |
| Production build | `npm run build` | |
| Run production build | `npm start` (or `npx next start -p 3123`) | The port comes from `-p` or shell `PORT`, never from `.env.local` |

## Validation run — 2026-10-24

| Check | Result | Evidence |
| --- | --- | --- |
| Dependencies installed and consistent | PASS | `npm ls --depth=0` clean |
| Type check | PASS | `npx tsc --noEmit` exit 0 |
| Lint | PASS | `npx eslint .` exit 0, no warnings |
| `npm audit` | PASS | 0 vulnerabilities |
| Production build | PASS | `next build` exit 0, 20 pages generated (`○` static, `/stages/[stage]` partial prerender) |
| Runtime smoke test | PASS | `next start`; all 16 routes returned 200 |
| Unknown stage `/stages/bogus` | Fixed later the same day | Was HTTP 200 with `noindex`. Now 404; see [FINAL_OWNERSHIP_READINESS.md](FINAL_OWNERSHIP_READINESS.md) |
| Images `/media/*.jpg` | Expected miss | 404; UI falls back to gradients by design |
| Tests | NOT RUN | No tests exist |
| Browser interaction (clicking through) | Run later | Done with Playwright; results in [FINAL_OWNERSHIP_READINESS.md](FINAL_OWNERSHIP_READINESS.md#f-quality-verification) |

## Known warning

```
⚠ Next.js ignored package-lock.json in C:\Users\Coder\Desktop\filmMaker because it is
  outside the current Git repository
```

There is an empty stray `package-lock.json` in the parent folder (`filmMaker/`), outside the
repo. It is harmless and only affects this machine (a Vercel or CI checkout has no parent
folder). Deleting it (it lists no packages) removes the warning. It was left in place.

## Resetting demo state

The app saves state in the browser. Use the **Reset** button in the UI, or clear the
`mithraa-shi-brain-v1` key in DevTools → Application → Local Storage. If you change the
shape of `BrainState`, bump the key (`-v2`) so old saved state is not merged in.

## Adding media

Drop JPGs named exactly as listed in `public/media/README.md` (e.g. `dawn-courtyard.jpg`)
into `public/media/`. Only use images you have rights to.

## Next.js 16 note

`AGENTS.md` warns that this Next version differs from older docs. Read
`node_modules/next/dist/docs/` before using unfamiliar APIs (e.g. `PageProps<"/route">`,
`LayoutProps`, `cacheComponents`).
