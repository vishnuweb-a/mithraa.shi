import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PASSWORD, accountName, formAlert, createUser, mailCount, mailLink, signIn, signOut, uniqueEmail } from "./helpers";

const WORKSPACE = [
  "/desk", "/agents", "/pipeline", "/guardians", "/brain", "/roles",
  "/stages/ideate", "/stages/develop", "/stages/write", "/stages/protect", "/stages/finance",
  "/stages/prep", "/stages/production", "/stages/post", "/stages/release",
  "/stages/bogus", "/does-not-exist",
];
const COOKIE = "sb-127-auth-token";

test.describe("route protection (signed out)", () => {
  test("every workspace route redirects to /login with a safe next", async ({ request }) => {
    const home = await request.get("/", { maxRedirects: 0 });
    expect(home.status()).toBe(307);
    expect(home.headers().location).toBe("/login");
    for (const path of WORKSPACE) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(307);
      expect(res.headers().location, path).toBe(`/login?next=${encodeURIComponent(path)}`);
      expect(res.headers()["cache-control"], path).toContain("no-store");
    }
  });

  test("auth pages are public", async ({ request }) => {
    for (const path of ["/login", "/signup", "/forgot-password", "/reset-password"]) {
      expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(200);
    }
  });

  test("RSC and prefetch requests are redirected too, not rendered", async ({ request }) => {
    const res = await request.get("/brain", { maxRedirects: 0, headers: { RSC: "1", "Next-Router-Prefetch": "1" } });
    expect(res.status()).toBe(307);
  });

  test("a forged session cookie is not a session", async ({ request }) => {
    const fake = "base64-" + Buffer.from(JSON.stringify({ access_token: "x.y.z", refresh_token: "nope", expires_at: 9999999999 })).toString("base64url");
    const res = await request.get("/brain", { maxRedirects: 0, headers: { cookie: `${COOKIE}=${fake}` } });
    expect(res.status()).toBe(307);
  });
});

test.describe("OAuth callback", () => {
  const cases: [string, string][] = [
    ["/auth/callback", "/login?error=link"],
    ["/auth/callback?code=not-a-real-code", "/login?error=link"],
    ["/auth/callback?code=not-a-real-code&next=/stages/prep", "/login?error=link&next=%2Fstages%2Fprep"],
    ["/auth/callback?error=access_denied&error_description=User+cancelled", "/login?error=cancelled"],
    ["/auth/callback?error=server_error&error_description=%3Cscript%3E", "/login?error=provider"],
    ["/auth/callback?code=x&next=https://evil.example", "/login?error=link"],
    ["/auth/callback?code=x&next=//evil.example", "/login?error=link"],
  ];
  for (const [from, to] of cases) {
    test(`${from} -> ${to}`, async ({ request }) => {
      const res = await request.get(from, { maxRedirects: 0 });
      expect(res.status()).toBe(307);
      expect(new URL(res.headers().location).pathname + new URL(res.headers().location).search).toBe(to);
      expect(new URL(res.headers().location).host).toBe("localhost:3000");
    });
  }

  test("provider text is never echoed onto the login page", async ({ page }) => {
    await page.goto("/auth/callback?error=access_denied&error_description=%3Cb%3EHACKED%3C%2Fb%3E");
    await expect(formAlert(page)).toHaveText(/Google sign-in was cancelled/);
    await expect(page.getByText("HACKED")).toHaveCount(0);
  });
});

test.describe("Google sign-in", () => {
  for (const from of ["/login?next=/stages/prep", "/signup?next=/stages/prep"]) {
    test(`starts a PKCE flow for Google from ${from.split("?")[0]}`, async ({ page, context }) => {
      // let local Supabase answer /authorize, read where it sends the browser, and stop before Google itself
      let authorize: URL | undefined;
      let google: URL | undefined;
      await context.route("**/auth/v1/authorize?**", async (route) => {
        authorize = new URL(route.request().url());
        const res = await route.fetch({ maxRedirects: 0 });
        google = new URL(res.headers().location);
        await route.fulfill({ status: 200, contentType: "text/plain", body: "google consent stub" });
      });
      await page.goto(from);
      await page.getByRole("button", { name: "Continue with Google" }).click();
      await expect(page.getByText("google consent stub")).toBeVisible();
      expect(authorize?.searchParams.get("provider")).toBe("google");
      expect(authorize?.searchParams.get("code_challenge_method")).toBe("s256");
      expect(authorize?.searchParams.get("code_challenge")).toBeTruthy();
      expect(authorize?.searchParams.get("redirect_to")).toBe("http://localhost:3000/auth/callback?next=%2Fstages%2Fprep");
      // Supabase Auth hands off to Google with its own callback, never the app's
      expect(google?.host).toBe("accounts.google.com");
      expect(google?.searchParams.get("client_id")).toBeTruthy();
      expect(google?.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:54321/auth/v1/callback");
      // the server action stored the PKCE verifier; /auth/callback needs it to exchange the code
      const verifier = (await context.cookies()).find((c) => c.name === `${COOKIE}-code-verifier`);
      expect(verifier?.value).toBeTruthy();
    });
  }

  test("a sign-in redirect never points away from this app", async ({ page }) => {
    const authorize = page.waitForRequest((r) => r.url().includes("/auth/v1/authorize"));
    await page.context().route("**/auth/v1/authorize?**", (r) => r.fulfill({ body: "stub" }));
    await page.goto("/login?next=https://evil.example/x");
    await page.getByRole("button", { name: "Continue with Google" }).click();
    expect(new URL((await authorize).url()).searchParams.get("redirect_to")).toBe("http://localhost:3000/auth/callback?next=%2F");
  });
});

test.describe("email and password", () => {
  test("sign up, verify by email, land signed in", async ({ page, context }) => {
    const email = uniqueEmail("signup");
    await page.goto("/signup?next=/stages/write");
    await page.getByLabel("Full name").fill("Meera Nair");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create Account" }).click();
    await expect(page.getByTestId("verify-pending")).toContainText(email);
    expect((await context.cookies()).some((c) => c.name === COOKIE)).toBe(false);

    // unverified accounts cannot sign in
    await signIn(page, email);
    await expect(formAlert(page)).toContainText("Confirm your email first");

    // the emailed link goes through Supabase, then /auth/callback exchanges the PKCE code
    await page.goto(await mailLink(email));
    await expect(page).toHaveURL(/\/stages\/write$/);
    await expect(accountName(page)).toHaveText("Meera Nair");
  });

  test("signing up with a taken email looks the same as a new one", async ({ page }) => {
    const email = uniqueEmail("taken");
    await createUser(email);
    await page.goto("/signup");
    await page.getByLabel("Full name").fill("Someone Else");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create Account" }).click();
    await expect(page.getByTestId("verify-pending")).toContainText(email);
    // and the original account still signs in with its own password
    await signIn(page, email);
    await expect(page).toHaveURL(/\/$/);
  });

  test("sign-up validation is inline and accessible", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Full name").fill("A");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password", { exact: true }).fill("short");
    await page.getByLabel("Confirm password").fill("short");
    await page.getByRole("button", { name: "Create Account" }).click();
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#email-error")).toHaveText("Enter a valid email address.");
    await expect(page.locator("#password-error")).toHaveText("Use at least 8 characters.");
    await expect(page.getByLabel("Full name")).toHaveValue("A");

    await page.getByLabel("Email").fill(uniqueEmail("mismatch"));
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD + "x");
    await page.getByRole("button", { name: "Create Account" }).click();
    await expect(page.locator("#confirm-error")).toHaveText("Passwords don't match.");
  });

  test("wrong password, then right password returns to the requested page", async ({ page }) => {
    const email = uniqueEmail("login");
    await createUser(email, "Arjun Rao");
    await signIn(page, email, "Wrong-password-1", "/login?next=/stages/prep");
    await expect(formAlert(page)).toContainText("don't match");
    await expect(page.getByLabel("Email address")).toHaveValue(email);

    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page).toHaveURL(/\/stages\/prep$/);
    await expect(accountName(page)).toHaveText("Arjun Rao");
  });

  test("password visibility toggle", async ({ page }) => {
    await page.goto("/login");
    const pw = page.getByLabel("Password", { exact: true });
    await expect(pw).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(pw).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(pw).toHaveAttribute("type", "password");
  });

  test("an open redirect in next is ignored after sign-in", async ({ page }) => {
    const email = uniqueEmail("redirect");
    await createUser(email);
    await signIn(page, email, PASSWORD, "/login?next=https://evil.example");
    await expect(page).toHaveURL("http://localhost:3000/");
  });
});

test.describe("session lifecycle", () => {
  test("persists across tabs, keeps signed-in users off /login, and refreshes an expired token", async ({ page, context }) => {
    const email = uniqueEmail("session");
    await createUser(email, "Kavi");
    await signIn(page, email);
    await expect(accountName(page)).toHaveText("Kavi");

    const tab = await context.newPage();
    await tab.goto("/brain");
    await expect(tab).toHaveURL(/\/brain$/);
    await tab.goto("/login");
    await expect(tab).toHaveURL("http://localhost:3000/");

    // age the access token: the proxy must refresh it with the refresh token, not sign the user out
    const cookie = (await context.cookies()).find((c) => c.name === COOKIE)!;
    const session = JSON.parse(Buffer.from(cookie.value.replace(/^base64-/, ""), "base64url").toString());
    const before = session.access_token;
    session.expires_at = Math.floor(Date.now() / 1000) - 60;
    await context.addCookies([{ ...cookie, value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url") }]);
    await tab.goto("/agents");
    await expect(tab).toHaveURL(/\/agents$/);
    const after = JSON.parse(Buffer.from((await context.cookies()).find((c) => c.name === COOKIE)!.value.replace(/^base64-/, ""), "base64url").toString());
    expect(after.access_token).not.toBe(before);
  });

  test("a revoked refresh token sends the user to sign in", async ({ page, context, browser }) => {
    const email = uniqueEmail("revoked");
    await createUser(email);
    await signIn(page, email);
    await expect(page).toHaveURL("http://localhost:3000/");
    const cookie = (await context.cookies()).find((c) => c.name === COOKIE)!;

    // signing out revokes this session server-side
    await signOut(page);

    // replaying the old cookie with an expired access token cannot refresh any more
    const session = JSON.parse(Buffer.from(cookie.value.replace(/^base64-/, ""), "base64url").toString());
    session.expires_at = Math.floor(Date.now() / 1000) - 60;
    const replay = await browser.newContext();
    await replay.addCookies([{ ...cookie, value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url") }]);
    const p = await replay.newPage();
    await p.goto("/stages/prep");
    await expect(p).toHaveURL(/\/login\?next=%2Fstages%2Fprep$/);
    await replay.close();
  });

  test("sign out clears the session; back and refresh do not bring the workspace back", async ({ page, context }) => {
    const email = uniqueEmail("logout");
    await createUser(email);
    await signIn(page, email, PASSWORD, "/login?next=/brain");
    await expect(page).toHaveURL(/\/brain$/);
    await signOut(page);
    expect((await context.cookies()).some((c) => c.name === COOKIE && c.value)).toBe(false);

    await page.goBack();
    await page.reload();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/stages/prep");
    await expect(page).toHaveURL(/\/login\?next=%2Fstages%2Fprep$/);
  });

  test("the next person on the same browser sees their own account", async ({ page }) => {
    const a = uniqueEmail("user-a");
    const b = uniqueEmail("user-b");
    await createUser(a, "Person A");
    await createUser(b, "Person B");
    await signIn(page, a);
    await expect(accountName(page)).toHaveText("Person A");
    await signOut(page);
    await signIn(page, b);
    await expect(accountName(page)).toHaveText("Person B");
    const keys = await page.evaluate(() => Object.keys(localStorage));
    expect(keys.filter((k) => k.startsWith("mithraa-shi-brain-v1")).every((k) => k.includes(":"))).toBe(true);
  });
});

test.describe("password recovery", () => {
  test("unknown emails get the same answer and no mail", async ({ page }) => {
    const email = uniqueEmail("nobody");
    await page.goto("/forgot-password");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toContainText(`If an account exists for ${email}`);
    expect(await mailCount(email)).toBe(0);
  });

  test("visiting /reset-password without a recovery link cannot change a password", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByTestId("reset-invalid")).toBeVisible();

    // an ordinary signed-in session is not a recovery session either
    const email = uniqueEmail("not-recovery");
    await createUser(email);
    await signIn(page, email);
    await expect(page).toHaveURL("http://localhost:3000/");
    await page.goto("/reset-password");
    await expect(page.getByTestId("reset-invalid")).toBeVisible();
  });

  test("reset link -> new password -> old one stops working", async ({ page }) => {
    const email = uniqueEmail("reset");
    await createUser(email);
    await page.goto("/forgot-password");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toContainText(email);

    await page.goto(await mailLink(email));
    await expect(page).toHaveURL(/\/reset-password$/);
    const fresh = "New-film-pass-7";
    await page.getByLabel("New password", { exact: true }).fill(fresh);
    await page.getByLabel("Confirm new password").fill(fresh);
    await page.getByRole("button", { name: "Save password" }).click();
    await expect(page).toHaveURL("http://localhost:3000/");
    await signOut(page);

    await signIn(page, email, PASSWORD);
    await expect(formAlert(page)).toContainText("don't match");
    await signIn(page, email, fresh);
    await expect(page).toHaveURL("http://localhost:3000/");
  });

  test("a reset link works once", async ({ page, browser }) => {
    const email = uniqueEmail("reuse");
    await createUser(email);
    await page.goto("/forgot-password");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    const link = await mailLink(email);
    await page.goto(link);
    await expect(page).toHaveURL(/\/reset-password$/);
    // a second browser (no PKCE verifier) and a second use both fail
    const other = await browser.newContext();
    const p = await other.newPage();
    await p.goto(link);
    await expect(p).toHaveURL(/\/login\?error=/);
    await other.close();
  });
});

test.describe("accessibility", () => {
  for (const path of ["/login", "/signup", "/forgot-password", "/reset-password"]) {
    test(`${path} has no axe violations`, async ({ page }) => {
      await page.goto(path);
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
    });
  }
});
