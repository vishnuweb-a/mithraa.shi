# Ownership Handover

## What the application does today

mithraa.SHI is a design prototype of a studio OS for making a film with AI agents. It walks a
sample Tamil feature, **Kolam**, through 9 stages (Ideate → Release), and each stage ends in a
gate that a person with the right role signs. It is a convincing UI, and **all of the AI,
data and permissions are simulated in the browser**. See [REPOSITORY_OVERVIEW.md](REPOSITORY_OVERVIEW.md).

## How the system works

One Next.js 16 app. Pages are prerendered. `BrainProvider` holds state seeded from
`lib/data.ts` and saves it in `localStorage`. "Agents" are timers and text heuristics. See
[ARCHITECTURE.md](ARCHITECTURE.md).

## Infrastructure it depends on

At runtime, none. To build it, you need Node ≥ 20.9, npm and internet access for Google Fonts.

## Access you need

Admin on the GitHub repo, the Blueprint document, and details of any existing hosting or
domain. No API keys. See [REQUIRED_ACCESS_AND_CREDENTIALS.md](REQUIRED_ACCESS_AND_CREDENTIALS.md).

## Developing safely

- Read `node_modules/next/dist/docs/` for Next 16 APIs (see `AGENTS.md`).
- New screens: add `app/<route>/page.tsx` as a thin wrapper around a component in
  `components/pages/`, matching the existing pattern. Add data to `lib/data.ts`.
- New state: extend `BrainState` and `BrainApi` in `BrainProvider.tsx`, log actions with
  `push()`, and bump `KEY` if the stored shape changes.
- Before each merge, run `npm run lint`, `npx tsc --noEmit` and `npm run build`. There are no tests yet.

## Releases, monitoring, rollback

CI exists; releases go through Vercel. See [VERCEL_DEPLOYMENT_READINESS.md](VERCEL_DEPLOYMENT_READINESS.md) and
[PROJECT_OWNERSHIP_AND_INDEPENDENCE.md](PROJECT_OWNERSHIP_AND_INDEPENDENCE.md).

## Currently broken or missing

- Lint, types, build, the route smoke test and the browser walkthrough pass.
- Broken: a malformed saved `localStorage` value crashes `/brain`, `/desk` and `/stages/*` with no
  in-app way to recover (see [SECURITY_AUDIT.md](SECURITY_AUDIT.md) #2).
- Fixed: `/stages/<unknown>` used to return HTTP 200; it now returns 404.
- Missing: the 13 media stills, unit tests, and the whole backend from the
  README's vision (Project Brain DB, real agents, auth).
- Minor: `Still` accepts unused `letterbox`, `grain` and `aspect` props. `TODAY` and the
  timeline bounds (`2026-06-01` → `2027-07-01`) are hardcoded. A stray empty
  `package-lock.json` sits in the parent folder.

## Undocumented knowledge to ask the previous team about

1. The **Agentic Pipeline & Dashboard Blueprint** and any product requirements behind it.
2. ~~Is there a live deployment?~~ Yes: `https://mithraa-shi.vercel.app` (`bhawna1203s-projects`). It stays theirs. Ask whether they plan to keep it online, since it shows the same product.
3. Was this an AI-generated build ("Bhawna🤖")? What prompts or specs were used, and what review happened?
4. Intended backend stack: the code comment says PostgreSQL + vector index + knowledge graph. Was any of it built elsewhere?
5. Which AI models or providers were planned for the 44 agents and 7 guardians, and what budgets?
6. The source and licence of the intended photos for `public/media/`.
7. Who are the stakeholders and users, and is this a pitch demo or the start of the real product?
