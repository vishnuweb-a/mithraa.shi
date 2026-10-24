# Database and API Analysis

## Database — not applicable

There is no database, ORM, schema, migration or connection code. There are therefore no
destructive migrations or commands to worry about.

The data model lives as TypeScript in `lib/data.ts`. Main types and collections:

| Type / export | Contents |
| --- | --- |
| `StageId`, `Stage`, `STAGES` | 9 stages (`ideate` … `release`), each with dates, goal, agents, gate items, approvers |
| `Agent` | name, what it does/writes, status, task, `budgetK`/`spentK` spend cap |
| `GateItem` | `{ id, label, done }` |
| `RoleId`, `Role`, `ROLES` | 8 roles with a sample person, home view, visible stages |
| `Guardian`, `GUARDIANS`; `Flag`, `FLAGS` | 7 guardians and their flags with severity |
| `Approval`, `APPROVALS`; `FeedItem`, `FEED` | Pending sign-offs and agent output |
| `NOTES`, `AUDIT_SEED` | Script notes and the seeded audit log |
| Panel datasets | `IDEAS`, `MARKET`, `CHARACTERS`, `DRAFTS`, `FUNDERS`, `STRIPS`, `BUDGET_DEPTS`, `SHOTS`, `BURN`, `TERRITORIES`, … |
| `TODAY = "2026-10-21"` | Fixed "current date" used by the timeline (`components/pipeline/parts.tsx`) |

Use this file as the starting point for a real schema when a backend is built.

## Client-side persistence

`BrainProvider` saves this shape to `localStorage["mithraa-shi-brain-v1"]`:

```ts
{ role, checks, passed, approvals, feed, flags, notes, audit }
```

On load it does `{ ...initialState(), ...JSON.parse(saved) }` with no schema check. A malformed
or outdated value **does** break rendering (reproduced on 2026-10-24), and the Reset button is
not reachable from the error screen. Clear the key in DevTools to recover. See
[SECURITY_AUDIT.md](SECURITY_AUDIT.md) #2.

## API — not applicable

No `app/api/` routes, `route.ts` handlers, server actions (`"use server"`), middleware/proxy,
or outbound `fetch`. There is no authentication, session storage, rate limiting, server-side
validation or background jobs.

The only server work is prerendering. `app/stages/[stage]/page.tsx` validates `stage`
against `STAGES` and calls `notFound()` for unknown ids, which return HTTP 404.

## Initialising a clean development "database"

Not applicable. Clearing `localStorage` (or the Reset button) gives you the seeded state.
