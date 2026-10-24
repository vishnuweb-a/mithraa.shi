# Changelog

All notable changes to mithraa.SHI are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). It is pre-release, so every
change sits under `0.1.0` / Unreleased until the first tagged release.

## [Unreleased]

### Added

- **Project Brain database foundation (Phase 1A)** on `feat/project-brain-foundation`, `7469bc8`.
  It has not been deployed to a remote Supabase project.
  - Supabase migration `20261024183806_project_brain_foundation.sql`. It adds projects,
    project membership with project-scoped roles, the nine production stages, a configurable
    multi-signer gate policy, gate checklists, append-only gate decisions, Project Brain
    records and a trigger-written audit trail.
  - Row Level Security on every table, column-level grants, and `public.create_project()` as
    the only way to create a project.
  - Safeguards: agents and service code cannot sign gates, and client requests cannot forge
    signers, audit actors or timestamps. Decisions and audit rows are append-only, and
    TRUNCATE is revoked on those tables.
  - A pgTAP security suite with 78 assertions (`supabase/tests/`), including solo-filmmaker and
    team gate scenarios, and the `db:test` / `db:types` npm scripts.
  - CI `db-test` job: runs the pgTAP suite against a throwaway local Supabase stack. It never
    connects to a remote project.
  - Typed Supabase clients for browser and server (`lib/supabase/`), using
    `@supabase/supabase-js@2.117.3` and `@supabase/ssr@0.12.7`. No screen uses them yet.
  - Docs: `PROJECT_BRAIN_DATABASE_ARCHITECTURE.md`, `SUPABASE_INTEGRATION_STATUS.md` and
    `PHASE_1A_IMPLEMENTATION_REPORT.md`.
- `CHANGELOG.md`.

### Changed

- Gate 8 default policy follows the blueprint (director + buyer). The prototype's producer
  signer is dropped.
- Gate 4 notes that its producer signer comes from the prototype, not the blueprint
  (`0b64047`).

### Fixed

- Gate decisions: repeating your latest decision in the same role is rejected (`23505`). One
  person may still sign once in each role they hold.
- A multi-row decision insert that passes a gate writes one `gate.passed` audit row, not one per row.

### Security

- `TRUNCATE` is revoked from `service_role` on `approval_decisions` and `audit_events`.
  TRUNCATE skips row triggers, so it would bypass the append-only guard.

## [0.1.0] - 2026-10-24

### Added

- Independent onboarding (#1, `3a157c0`):
  - GitHub Actions CI with typecheck, lint, build and a route smoke test.
  - `.env.example`.
  - Security headers in `next.config.ts`.
  - Onboarding, architecture, deployment and security docs under `docs/`.

### Fixed

- Unknown stage routes (`/stages/<bogus>`) now return 404.

## 2026-10-21 - Final design (`77ea338`)

### Added

- Full prototype UI: home desk, agents, pipeline map, guardians, Brain, roles and the nine
  stage workspaces. All are driven by sample data in `lib/data.ts`.

## 2026-10-20 - Initial codebase (`819835a`)

### Added

- Next.js application scaffold.

[Unreleased]: https://github.com/vishnuweb-a/mithraa.shi/compare/main...feat/project-brain-foundation
[0.1.0]: https://github.com/vishnuweb-a/mithraa.shi/commit/6016ba4
