import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end auth tests against a production build and a LOCAL Supabase stack
 * (never a hosted project). Needs `supabase start` and the env from
 * `supabase status -o env`; see docs/SUPABASE_AUTHENTICATION_IMPLEMENTATION.md.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx next start -p 3000",
    url: "http://localhost:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
