# Environment Setup

## Audit result

**The application references zero environment variables.**

How this was checked (2026-10-24):

- Searched `app/`, `components/`, `lib/`, `next.config.ts` for `process.env`,
  `import.meta.env`, `NEXT_PUBLIC_`, `dotenv`. No matches.
- No API routes, server actions, `fetch` calls, `cookies()`/`headers()` usage.
- No Docker Compose, serverless or `vercel.json` config that injects variables. The CI workflow
  added later (`.github/workflows/ci.yml`) sets only `NEXT_TELEMETRY_DISABLED`.
- No `.env*` file was ever committed (`git ls-files` checked).
- `npm run build` and `next start` succeed with no env file present.

## Variables (all optional, framework-level)

| Variable | Read by | Required | Secret | Default | Effect if missing |
| --- | --- | --- | --- | --- | --- |
| `NEXT_TELEMETRY_DISABLED` | Next.js CLI | No | No | unset (telemetry on) | Anonymous telemetry sent |
| `NODE_ENV` | Next.js (set automatically) | No — do not set by hand | No | `development` / `production` per command | — |

Verified on Next.js 16.4.2 (2026-10-24):

- **`NEXT_TELEMETRY_DISABLED` works from `.env.local`.** `next build` loads dotenv files before it
  creates the telemetry client (`node_modules/next/dist/build/index.js`: `loadEnvConfig` at line 486,
  `new Telemetry` at line 540), and the client reads `process.env` in its constructor. After
  loading `.env.local` with `NEXT_TELEMETRY_DISABLED=1`, `Telemetry.isDisabled` is `true`.
- **The server port is not read from dotenv files.** With `PORT=3456` in `.env.local`, both
  `next dev` and `next start` still listened on 3000. Set the port on the command line or in the
  shell instead:

  ```bash
  npm run dev -- -p 3001          # dev server
  npx next start -p 3001          # production server
  PORT=3001 npm start             # bash; PowerShell: $env:PORT=3001; npm start
  ```

  `PORT` was therefore removed from `.env.example` and `.env.local`.

## Vercel

**No environment variables are required** for Vercel Preview or Production. Vercel sets the port
itself. Do not copy `.env.local` into Vercel. See
[VERCEL_DEPLOYMENT_READINESS.md](VERCEL_DEPLOYMENT_READINESS.md).

## Files

| File | Tracked in git | Purpose |
| --- | --- | --- |
| `.env.example` | Not yet: untracked, **not ignored**, so it is committed with the next `git add` (`.gitignore` has `!.env.example`) | Documents the result above and the optional settings |
| `.env.local`, `.env.production.local`, `.env`, any other `.env*` | No: ignored by `.env*` (checked with `git check-ignore -v`) | Local overrides; `.env.local` currently holds comments only |

`.gitignore` change: previously `.env*` also ignored `.env.example`. One line
`!.env.example` was added so the template can be committed.

## When a backend is added

The intended production design (per `lib/data.ts` and the README) implies future variables
such as a PostgreSQL connection string, vector index credentials, AI model API keys and auth
secrets. **None of these are required today**, so no placeholders were invented. Add them to
`.env.example` in the same change that adds the code reading them.

Rules for that work:

- Secrets go only in server code. Never prefix a secret with `NEXT_PUBLIC_` (that ships it to the browser).
- Use `.env.local` locally and the host's secret store in production.
- Keep development and production credentials separate.
