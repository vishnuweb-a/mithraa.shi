import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end auth tests against a production build and a LOCAL Supabase stack
 * (never a hosted project). Needs `supabase start` and the env from
 * `supabase status -o env`; see docs/SUPABASE_AUTHENTICATION_IMPLEMENTATION.md.
 */
// Fail closed: `next start` inherits this env over .env, so a missing or hosted URL here would aim the app at a real project.
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/;
const LOCAL_APP = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/;
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "API_URL"]) {
  if (!LOCAL.test(process.env[k] ?? "")) throw new Error(`${k} must point at a local Supabase (export \`supabase status -o env\`), got "${process.env[k] ?? ""}"`);
}
// NEXT_PUBLIC_* are inlined at build time: the build must carry this local URL and no concrete hosted project URL
// (supabase-js itself mentions ".supabase.co" generically, so match a 20-char project ref, not the bare domain).
const HOSTED = /https:\/\/[a-z0-9]{20}\.supabase\.(co|in)/;
const bundle = ["server", "static"].flatMap((d) =>
  readdirSync(join(".next", d), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(join(".next", d, f), "utf8")),
);
if (!bundle.some((s) => s.includes(process.env.NEXT_PUBLIC_SUPABASE_URL!))) throw new Error("the .next build was not made with this local NEXT_PUBLIC_SUPABASE_URL: rebuild with the local env");
if (bundle.some((s) => HOSTED.test(s))) throw new Error("the .next build points at a hosted Supabase: rebuild with the local env");
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
if (!LOCAL_APP.test(BASE)) throw new Error(`E2E_BASE_URL must be a loopback origin with a port, got "${BASE}"`);
const PORT = new URL(BASE).port;
// the local stack's site_url and redirect allow-list are :3000 (supabase/config.toml), so on any other port its email
// links fall back to whatever serves :3000 (often `next dev` with the hosted .env): run only the UI specs there
const UI_ONLY = PORT !== "3000";

export default defineConfig({
  testDir: "e2e",
  testIgnore: UI_ONLY ? "auth.spec.ts" : undefined,
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: { baseURL: BASE, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `${BASE}/login`,
    // never reuse: a server already on this port (e.g. `next dev` with the hosted .env) did not get the env checked above
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
