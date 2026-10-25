# Supabase Authentication (Phase 1B)

Sign-in is mandatory for the whole filmmaking workspace. Two methods only: **email/password** and
**Google OAuth**, both through Supabase Auth. No Apple, Facebook, GitHub, phone or anonymous sign-in.

## How it fits together

| Piece | File | Job |
| --- | --- | --- |
| Proxy | `proxy.ts` | Refreshes the session cookie on every request (`getClaims`), sends signed-out visitors to `/login?next=…`, keeps signed-in users off the auth pages, sets `Cache-Control: private, no-store` on protected responses. Deny by default. |
| Workspace guard | `app/(workspace)/layout.tsx`, `lib/auth/user.ts` | `requireUser()` verifies the JWT again on the server. The proxy is a convenience, not the authorization boundary. |
| Server actions | `app/(auth)/actions.ts` | Sign in, sign up, Google, forgot password, set new password, sign out. |
| Error copy | `lib/auth/messages.ts` | Maps Supabase error codes to fixed user-facing text; provider text never reaches the page. |
| Callback | `app/auth/callback/route.ts` | Exchanges the PKCE code (Google, email confirmation, password reset) for a session, then redirects to a same-origin path only. |
| Redirect sanitizer | `lib/auth/redirect.ts` | `safeNext()`: absolute, protocol-relative, backslash and auth-page targets become `/`. |
| Profiles | `supabase/migrations/20261025200000_auth_profile_names.sql` | `display_name` from email sign-up or Google `full_name`/`name`. Display only, never authorization. New accounts get no project membership. |
| UI | `app/(auth)/layout.tsx`, `components/auth/*` | Cinematic Sign In / Sign Up from `docs/assets/`, on the existing brand tokens (Space Grotesk, Inter, brand lime). |

## Local setup

```bash
supabase start                     # local stack in Docker; never a hosted project
eval "$(supabase status -o env)"
export NEXT_PUBLIC_SUPABASE_URL=$API_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$PUBLISHABLE_KEY
npm run build                      # NEXT_PUBLIC_* values are inlined at build time
npm run test:e2e                   # starts `next start` on :3000; needs SERVICE_ROLE_KEY, MAILPIT_URL in env
```

The e2e helpers refuse to run against anything but `127.0.0.1`/`localhost`. The service-role key lives
in the test process only. Google keys can be dummies (`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`,
`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`): the tests stop at the hand-off to `accounts.google.com`.

Race tests without a local `psql`:
`PSQL="docker exec -i supabase_db_mithraa.shi psql -U postgres" bash supabase/tests/concurrency.sh`

## Manual setup for a hosted project (not done by this PR)

1. Supabase > Authentication > URL Configuration: Site URL = the app origin; redirect URLs include
   `<origin>/auth/callback**` for production and each preview origin.
2. Google provider: a Google Cloud OAuth client whose authorized redirect URI is
   `https://<project-ref>.supabase.co/auth/v1/callback`; client ID and secret in the Supabase dashboard.
3. Custom SMTP (Supabase's built-in sender is rate-limited and not for production).
4. Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, optional `SITE_URL`.
5. Keep "Confirm email" on. The password-reset guard and the account-linking check below assume it.

No remote migrations, production Google settings or Supabase settings were changed.

## Review fixes (initial Ponytail review)

### Fix 1: password reset action authorization

`updatePassword` re-checks `hasRecoverySession()` on every submission. It reads the **signed** `amr`
claim via `getClaims()` and accepts only a `recovery` entry less than one hour old. The guard was
already correct; no implementation change. New regression coverage in `e2e/auth.spec.ts`:

- **Stale form, ordinary session** ("a reset form left open cannot set a password…"): tab A opens a
  real emailed recovery link and shows the form. Tab B, same browser, signs out and signs in with the
  password. Tab A submits without reloading. The POST reaches the real server action (asserted via the
  `Next-Action` request), which answers "This reset link has expired. Request a new one." The
  attempted password is rejected at login, the old one still works, and tab B's session is untouched.
  This is also the direct-invocation case: the action is called with an ordinary authenticated session.
- **Forged recovery claim**: a cookie carrying a JWT with `amr: recovery`, signed with a made-up key,
  does not unlock the reset form.
- Existing: a valid recovery session still changes the password; `/reset-password` without a link or
  with an ordinary session shows "isn't valid"; a reset link works once and only in the browser that
  requested it (PKCE verifier).
- Not automated: the one-hour expiry (would need a clock change). It is the `now - timestamp < 3600`
  check in `lib/auth/user.ts`.

### Fix 2: password reset email errors

`requestPasswordReset` no longer reports "sent" unless Supabase accepted the request. Error shapes
were recorded from the real local GoTrue (Supabase CLI 2.115.0), including a real SMTP outage
(Mailpit container stopped) and a real unreachable API (Kong container stopped):

| Situation | Supabase returns | User sees |
| --- | --- | --- |
| Accepted (known or unknown email) | no error | "If an account exists for …, a reset link is on its way." |
| Repeat request inside the per-address cooldown | 429 `over_email_send_rate_limit`, "you can only request this after N seconds" | Same generic success (see below) |
| Project-wide email quota / request limit | 429 `over_email_send_rate_limit` / `over_request_rate_limit` | "Too many emails sent / attempts. Wait a minute and try again." |
| SMTP or provider failure | `AuthRetryableFetchError` 500 "Error sending recovery email" | "We couldn't send the reset email just now. Try again in a few minutes." |
| Supabase unreachable | `AuthRetryableFetchError` status 0 | "We couldn't reach the sign-in service. Try again in a moment." |
| Address Supabase rejects | 400 `validation_failed` | Field error "Enter a valid email address." |

**Enumeration fix found while doing this:** GoTrue's per-address cooldown fires only for addresses that
have an account. The old code showed "Too many emails sent" for it, so asking twice revealed whether
an account existed. It now gets the generic success; a link went out moments earlier anyway. The match
is on GoTrue's wording (`shortcut:` comment in `lib/auth/messages.ts`); if that changes it falls back
to the retry message, which reveals the account but never fakes a send.

**Accepted:** during an SMTP outage or once the project-wide email quota is used up, a real account
gets an error while an unknown address still gets success (Supabase never tries to email unknown
addresses). Telling the truth about delivery was the requirement; the exposure lasts only for the
outage.

Coverage: `lib/auth/messages.test.ts` (7 unit tests built from Supabase's own error classes with the
recorded shapes) plus the e2e tests for success and the unknown email. The UI for SMTP failure and
for unreachable Supabase was checked once against the real outages above; it is the same `Alert`
path the e2e suite covers for sign-in errors. The cooldown case is not an e2e test: local
`max_frequency` is 1 s and concurrent requests race past it, so such a test would be flaky.

### Fix 3: `KolamMark` extracted

`components/shell/KolamMark.tsx` holds the SVG unchanged and has no client directive. The auth layout
and the sidebar (`components/shell/Topbar.tsx`) both import it, so the auth pages no longer pull in the
sidebar client module and, through it, `lib/data`.

Measured on the production build (`next build` + `next start`, every `<script src>` on the page fetched
and summed, gzip level 6):

| Page | Before | After | Change |
| --- | --- | --- | --- |
| `/login`, `/signup`, `/forgot-password` | 10 scripts, 627.4 KB raw, 197.7 KB gzip | 9 scripts, 577.4 KB raw, 179.1 KB gzip | −50.0 KB raw, −18.6 KB gzip |
| Workspace markers in auth JS (`Salt Merchant`, `Radio Thatha`, `Budget Guardian`, `mithraa-shi-brain`) | all present | none | |

Sidebar and auth logos checked by screenshot after the change.

### Accepted finding: soft 404 on signed-in `/stages/bogus`

The workspace layout wraps `requireUser()` in `<Suspense>`, so the response starts streaming before
the stage page calls `notFound()`. Next.js then keeps HTTP **200** and injects
`<meta name="robots" content="noindex">` (see `node_modules/next/dist/docs/01-app/02-guides/streaming.md`,
"Status codes"). Signed-out requests still get the 307 to `/login`.

Test "an unknown stage shows the not-found page…": signed in, `/stages/bogus` returns 200 with
`no-store`, shows the 404 screen, carries `noindex`, and renders no stage dashboard or gate panel
(`/stages/prep` does, as a control).

Option not taken: the proxy could answer `404` for `/stages/<unknown>` before rendering, since the
stage list is static. That duplicates the stage list in the proxy and the gain is cosmetic on a
signed-in, non-indexed app, so it stays out of scope.

## Manual security check: Google sign-in vs an unconfirmed email/password account

**Status: NOT RUN.** The local stack uses dummy Google credentials, so a real Google login can't
complete. This stays a **release requirement** before production sign-ups open.

Why it matters (pre-account takeover): someone registers `victim@gmail.com` with their own password and
never confirms. Later the real owner signs in with Google. If Supabase links the two and keeps the
first password, the registrant could sign in to the owner's account and see any projects the owner
joins. Do not assume GoTrue's behavior; record what actually happens. Do not add custom linking by
matching email strings (`enable_manual_linking = false` stays off).

Run on a development Supabase project with a real Google OAuth client and controlled test accounts only:

1. Sign up at `/signup` with `<test-google-account>@gmail.com` and password P. Do not open the email.
2. In Studio (or `select id, email, email_confirmed_at from auth.users where email = …`), record the
   user id U1 and that `email_confirmed_at` is null.
3. In a fresh browser profile, "Continue with Google" with that same Google account.
4. Record: the resulting user id (U1 again or a new U2); rows in `auth.identities` for the address
   (`provider`, `user_id`, `identity_data->>'email_verified'`; never copy tokens);
   `email_confirmed_at` afterwards.
5. Try signing in with email + password P. **Pass:** this fails. If Supabase linked the Google
   identity to U1, P must no longer work.
6. Have a producer add U1 to a test project, then sign in via Google. Confirm the Google session sees
   only that membership with the role granted (`project_members`), and no producer, director or other
   role it was not given. Confirm an unrelated account sees nothing (RLS, `supabase/tests/project_brain_rls.test.sql`).
7. Record the outcome in this section: date, Supabase version, U1/U2, identities, pass/fail.

Fail on step 5 or 6: block release and file it; fixes would be Supabase settings, not app code.

## Test results (local, 2026-10-25)

| Suite | Result |
| --- | --- |
| `supabase db reset` (clean) | OK |
| pgTAP (`supabase test db --local`) | 5 files, **204 passed**, 0 failed |
| Race tests (`supabase/tests/concurrency.sh`) | **12 passed**, 0 failed |
| `supabase db lint --local` | No schema errors |
| Unit (`npm run test:unit`) | **10 passed** (3 redirect, 7 reset reply) |
| Playwright (`npm run test:e2e`) | **46 passed**, 0 failed, 0 skipped (36 auth, 10 responsive) |
| Typecheck, ESLint, production build | Pass |
| CI route smoke test (no Supabase env) | 23 of 23 checks pass |

Playwright auth tests include: route protection (signed out, RSC/prefetch, forged cookie), OAuth
callback errors and open redirects, the Google PKCE hand-off (**stubbed at Google; no real Google login
was tested**), sign-up with email verification, login, session refresh and revocation, sign-out,
password recovery (incl. the stale form and forged claim), soft 404, and axe accessibility on the four
auth pages. Responsive tests cover `/login` and `/signup` at 1536, 1280, 820, 390 and 320 px: no
horizontal overflow, touch targets ≥ 40 px.

CI (`.github/workflows/ci.yml`): `verify` runs typecheck, lint, unit, build and the route smoke test;
`db-test` runs pgTAP, race tests and the full Playwright suite against a throwaway local stack.

## Final Ponytail review

Complete branch diff vs `main` (original implementation plus these fixes), 2026-10-25. Re-checked:
recovery authorization, stale forms, OAuth callback, session refresh and invalidation, email delivery
errors, account enumeration, Google linking, cookie and token leakage, open redirects, protected
access, module boundaries, caching of authenticated pages, cross-project RLS.

- Must fix / Should fix: none.
- Nice to have (applied): reuse `openResetLink` in an existing test; top-level `node:crypto` import.
- Verdict: **Ship.** Not checked: Google linking with an unconfirmed account (manual check above).

## Remaining risks

- Google linking with an unconfirmed email/password account: unverified (manual check above).
- Enumeration during SMTP outages or quota exhaustion (accepted, see Fix 2).
- The cooldown check depends on GoTrue's message wording (fails safe).
- A recovery session is a full session for up to an hour, and can change the password again within
  that hour. This is standard Supabase recovery behavior.
- Soft 404 (status 200 + `noindex`) for unknown stages when signed in.
- Hosted Supabase URL allow-list, Google client and SMTP must be configured by the owner.
