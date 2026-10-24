# Security Audit

*Non-destructive review, 2026-10-24.* The attack surface is very small: a static site with
no backend, secrets, user accounts or stored server data. No Critical or High findings
apply **to the prototype as it is**.

| # | Severity | Finding | Evidence | Remediation |
| --- | --- | --- | --- | --- |
| 1 | Medium (Critical if reused in production) | Role-based gate approval is client-side only. Anyone can pick "Producer" in the sidebar and sign any gate. | `canSign()` / `setRole()` in `components/brain/BrainProvider.tsx` | Fine for a demo. In a real product, enforce roles and gate signing on the server with authenticated users; treat the client checks as UX only. |
| 2 | Low (availability; client-only) | Saved state from `localStorage` is merged without validation. **Reproduced:** `{"checks":null,"audit":"x"}` crashes `/brain` (`e.filter is not a function`), `/desk` and `/stages/prep` (`Cannot read properties of null (reading 'r1')`) with "This page couldn't load". The sidebar Reset is not rendered on that screen, so recovery means clearing site data. Also triggered by any future shape change that forgets to bump `KEY`. | `setState((s) => ({ ...s, ...saved }))` in `BrainProvider.tsx`; Playwright run 2026-10-24 | Keep only saved fields whose type matches `initialState()` (no new dependency needed), or catch the error and fall back to defaults; bump `KEY` on shape changes. |
| 3 | Low (partly fixed) | No security headers; `X-Powered-By: Next.js` sent. | `curl -I` on `next start` | **Fixed:** `poweredByHeader: false`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` (verified with `curl -I`). **Open:** CSP. Vercel's own headers (e.g. `Server: Vercel`) still identify the host. |
| 4 | Low (fixed) | `.gitignore` pattern `.env*` also ignored `.env.example`. | `.gitignore` | Added `!.env.example`. |
| 5 | Info | Commits are authored by "Bhawna🤖", which may indicate AI-generated code with no review record (unverified). | `git log` | Review code before extending it; no unsafe patterns were found. |
| 6 | Medium (operational) | Inherited deployment identity. The fork's GitHub "Website" field points to the former team's `https://mithraa-shi.vercel.app`, and that site serves the same app. A Vercel project in scope `vishnus-projects-c4d53dca` already deploys this fork; its owner is unconfirmed. | GitHub API `homepage`; commit status on `77ea338` | Confirm that you own the Vercel project, clear or replace the Website field, and never link the repo to `bhawna1203s-projects`. See [PROJECT_OWNERSHIP_AND_INDEPENDENCE.md](PROJECT_OWNERSHIP_AND_INDEPENDENCE.md). |

## Checked and clean

- **Hardcoded credentials:** none (source and git-tracked files searched; no `.env`, `.pem` or key files tracked).
- **Client-side secrets / `NEXT_PUBLIC_*`:** none.
- **XSS sinks:** no `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function`. User text (Studio prompt, notes, Ask SHI) is rendered through React escaping.
- **CORS / CSRF:** not applicable (no endpoints or cookies).
- **Webhooks / payments:** not applicable.
- **Sensitive logging:** no logging of user data; audit log stays in the browser.
- **Dependencies:** `npm audit` reports 0 vulnerabilities.
- **Debug config in production:** none; `next start` serves a production build.

## Before this becomes a real product

Add authentication and server-side authorization, a CSP, server-side input validation,
rate limiting on any AI endpoints, and per-user spend limits for model calls, which the UI
already shows as `budgetK`.
