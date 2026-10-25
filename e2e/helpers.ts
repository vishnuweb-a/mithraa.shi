import { expect, type Page } from "@playwright/test";

// Local stack only. The service-role key lives in the test process, never in the app.
const API = process.env.API_URL ?? "http://127.0.0.1:54321";
const SERVICE = process.env.SERVICE_ROLE_KEY ?? "";
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(API)) throw new Error(`e2e tests only run against a local Supabase, got ${API}`);

export const PASSWORD = "Film-maker-42";

export const uniqueEmail = (tag: string) => `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;

/** A confirmed email/password account, created through the admin API. */
export async function createUser(email: string, name = "Test Director", password = PASSWORD) {
  if (!SERVICE) throw new Error("SERVICE_ROLE_KEY is not set: export the output of `supabase status -o env`");
  const res = await fetch(`${API}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "content-type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { display_name: name } }),
  });
  expect(res.ok, await res.clone().text()).toBeTruthy();
  return (await res.json()) as { id: string };
}

/** The first link in the newest email to `to` (Mailpit, the local SMTP catcher). */
export async function mailLink(to: string): Promise<string> {
  let id: string | undefined;
  await expect
    .poll(
      async () => {
        const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
        id = ((await r.json()) as { messages?: { ID: string }[] }).messages?.[0]?.ID;
        return id;
      },
      { timeout: 15_000 },
    )
    .toBeTruthy();
  const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { HTML: string };
  const href = msg.HTML.match(/href="([^"]+)"/)?.[1];
  if (!href) throw new Error("no link in email");
  return href.replaceAll("&amp;", "&");
}

export async function mailCount(to: string) {
  const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  return ((await r.json()) as { messages_count?: number }).messages_count ?? 0;
}

export async function signIn(page: Page, email: string, password = PASSWORD, path = "/login") {
  await page.goto(path);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await expect(page).toHaveURL(/\/login$/);
}

export const accountName = (page: Page) => page.getByTestId("account-name").first();

/** The form's own error or notice (Next's route announcer is also role=alert). */
export const formAlert = (page: Page) => page.locator("p[role=alert]");
