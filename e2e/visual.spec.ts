import { test, expect, type Page } from "@playwright/test";

// Responsive checks for the auth screens. Screenshots land in test-results/ and are copied to docs by hand.
const VIEWPORTS = [
  { name: "large", width: 1920, height: 1080 },
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "small-laptop", width: 1024, height: 768 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "large-mobile", width: 430, height: 932 },
  { name: "mobile", width: 390, height: 844 },
  { name: "mobile-375", width: 375, height: 667 },
  { name: "small", width: 320, height: 640 },
];

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const vp of VIEWPORTS) {
  for (const path of ["/login", "/signup"]) {
    test(`${path} at ${vp.name} ${vp.width}px`, async ({ page }, info) => {
      await page.setViewportSize(vp);
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
      // only Google: no decorative or dead provider buttons
      await expect(page.getByRole("button", { name: /apple|facebook|github/i })).toHaveCount(0);
      expect(await overflow(page), "horizontal overflow").toBeLessThanOrEqual(0);

      // frame and card stay inside the viewport; the form keeps a readable width
      const frame = (await page.locator(".auth-frame").boundingBox())!;
      const card = (await page.locator(".auth-card").boundingBox())!;
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.x + frame.width).toBeLessThanOrEqual(vp.width);
      expect(card.x).toBeGreaterThanOrEqual(frame.x);
      expect(card.x + card.width).toBeLessThanOrEqual(frame.x + frame.width + 0.5);
      expect(card.width, "card max width").toBeLessThanOrEqual(500);

      // every control sits inside the card, is tall enough to tap, and is the topmost element at its centre
      for (const c of await page.locator(".auth-card :is(a, button, input:not([type=hidden]))").all()) {
        const box = (await c.boundingBox())!;
        const what = await c.evaluate((e) => e.outerHTML.slice(0, 60));
        expect(box.x, what).toBeGreaterThanOrEqual(card.x - 0.5);
        expect(box.x + box.width, what).toBeLessThanOrEqual(card.x + card.width + 0.5);
        if (await c.evaluate((e) => e.tagName !== "A")) expect(box.height, what).toBeGreaterThanOrEqual(40);
        await c.scrollIntoViewIfNeeded();
        expect(await c.evaluate((e) => {
          const r = e.getClientRects()[0]; // first line box: a wrapped link's bounding box centre can fall between its lines
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return !!hit && (e === hit || e.contains(hit));
        }), `${what} is covered`).toBe(true);
      }

      // poster art: shown only beside the form, kept inside the brand column at a fixed shape
      const stage = page.locator("figure.auth-poster").first().locator("..");
      if (vp.width >= 1024) {
        await expect(stage).toBeVisible();
        const s = (await stage.boundingBox())!;
        const brand = (await page.locator(".auth-frame > section").first().boundingBox())!;
        expect(s.x).toBeGreaterThanOrEqual(brand.x);
        expect(s.x + s.width).toBeLessThanOrEqual(brand.x + brand.width);
        expect(s.x + s.width, "posters clear of the form").toBeLessThanOrEqual(card.x);
        expect(s.width / s.height).toBeCloseTo(8 / 3, 1);
      } else {
        await expect(stage).toBeHidden();
      }
      await page.screenshot({ path: info.outputPath(`${path.slice(1)}-${vp.name}.png`), fullPage: true });
    });
  }
}

for (const vp of [{ width: 1280, height: 800 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
  test(`both forms fit ${vp.width}x${vp.height} without scrolling, in the same card`, async ({ page }) => {
    await page.setViewportSize(vp);
    const boxes = [];
    for (const path of ["/login", "/signup"]) {
      await page.goto(path);
      await expect(page.getByRole("button", { name: "Continue with Google" })).toBeInViewport({ ratio: 1 });
      await expect(page.locator(".auth-card form button[type=submit]").first()).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => document.documentElement.scrollHeight), path).toBeLessThanOrEqual(vp.height);
      boxes.push(await page.locator(".auth-card").boundingBox(), await page.getByRole("navigation", { name: "Account" }).boundingBox());
    }
    // card and tabs don't move or resize between the two pages
    expect(boxes[2]).toEqual(boxes[0]);
    expect(boxes[3]).toEqual(boxes[1]);
  });
}

test("sign-up validation errors wrap inside the card without overlapping", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`${"a".repeat(70)}@${"b".repeat(40)}.studio`);
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByRole("button", { name: "Create Account" }).click();
  await expect(page.getByText("Enter your full name.")).toBeVisible();
  await expect(page.getByText("Use at least 8 characters.")).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  const rows = await page.locator(".auth-card form > :not([type=hidden])").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.top, r.bottom]));
  for (let i = 1; i < rows.length; i++) expect(rows[i][0], "form rows overlap").toBeGreaterThanOrEqual(rows[i - 1][1]);
});

test("paired password fields toggle visibility independently", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/signup");
  await page.getByRole("button", { name: "Show password" }).first().click();
  await expect(page.locator("#password")).toHaveAttribute("type", "text");
  await expect(page.locator("#confirm")).toHaveAttribute("type", "password");
});

type Frame = { pseudo: string; name: string; end: number; opacity: number; shift: number[] };
type Probe = { __frames?: Promise<Frame[]> };

/**
 * Hooks document.startViewTransition so the next transition's animations are paused halfway and read back:
 * real intermediate styles, without depending on when a frame happens to be painted.
 */
async function probeNextTransition(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as Probe;
    w.__frames = undefined;
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = ((arg: Parameters<typeof start>[0]) => {
      const vt = start(arg);
      w.__frames = vt.ready.then(() =>
        document
          .getAnimations()
          .filter((a) => (a.effect as KeyframeEffect).pseudoElement?.startsWith("::view-transition"))
          .map((a) => {
            const e = a.effect as KeyframeEffect;
            const t = e.getComputedTiming();
            a.pause();
            a.currentTime = Number(t.delay) + Number(t.duration) / 2;
            const cs = getComputedStyle(document.documentElement, e.pseudoElement!);
            const frame = { pseudo: e.pseudoElement!, name: (a as CSSAnimation).animationName, end: Number(t.endTime), opacity: Number(cs.opacity), shift: cs.translate.split(" ").map(parseFloat) };
            a.play();
            return frame;
          }),
      );
      return vt;
    }) as typeof document.startViewTransition;
  });
  return async () => {
    await page.waitForFunction(() => (window as unknown as Probe).__frames);
    return page.evaluate(() => (window as unknown as Probe).__frames!);
  };
}

// tags the persistent shell, so a remount (a fresh element without the tag) shows up
const SHELL = ".auth-frame, .auth-poster";
const markShell = (page: Page) => page.evaluate((s) => document.querySelectorAll(s).forEach((e) => e.setAttribute("data-kept", "")), SHELL);
const shellKept = (page: Page) => page.evaluate((s) => [...document.querySelectorAll(s)].every((e) => e.hasAttribute("data-kept")), SHELL);

test.describe("sign in / sign up transition", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/login");
    await page.waitForLoadState("networkidle"); // the per-link prefetch of the other form has landed
  });

  test("switching tabs slides the form and morphs the tab pill, the shell stays put", async ({ page }) => {
    const tabs = page.getByRole("navigation", { name: "Account" });
    const posters = await page.locator(".auth-poster").first().boundingBox();
    await markShell(page);

    const forward = await probeNextTransition(page);
    await tabs.getByRole("link", { name: "Sign Up" }).click();
    const frames = await forward();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(tabs.getByRole("link", { name: "Sign Up" })).toHaveAttribute("aria-current", "page");
    await expect(tabs.getByRole("link", { name: "Sign In" })).not.toHaveAttribute("aria-current");

    // outgoing form: halfway faded and moving left; incoming: halfway in, arriving from the right
    const out = frames.find((f) => f.name === "auth-out" && f.pseudo.startsWith("::view-transition-old"));
    const into = frames.find((f) => f.name === "auth-in" && f.pseudo.startsWith("::view-transition-new"));
    expect(out, JSON.stringify(frames)).toBeTruthy();
    expect(into, JSON.stringify(frames)).toBeTruthy();
    for (const f of [out!, into!]) {
      expect(f.opacity).toBeGreaterThan(0);
      expect(f.opacity).toBeLessThan(1);
    }
    expect(out!.shift[0]).toBeLessThan(0);
    expect(into!.shift[0]).toBeGreaterThan(0);
    expect(frames.some((f) => f.pseudo === "::view-transition-group(auth-tab-pill)"), "tab pill morphs").toBe(true);
    for (const f of frames) expect(f.end, f.pseudo).toBeLessThanOrEqual(320);

    await expect(page.getByLabel("Full name")).toBeVisible();
    expect(await shellKept(page), "frame and artwork were not remounted").toBe(true);
    expect(await page.locator(".auth-poster").first().boundingBox()).toEqual(posters);

    // and back the other way
    const back = await probeNextTransition(page);
    await tabs.getByRole("link", { name: "Sign In" }).click();
    const reverse = await back();
    await expect(page).toHaveURL(/\/login$/);
    expect(reverse.find((f) => f.name === "auth-out")!.shift[0]).toBeGreaterThan(0);
    expect(reverse.find((f) => f.name === "auth-in")!.shift[0]).toBeLessThan(0);
    await expect(page.getByRole("heading", { name: "Welcome back!" })).toBeVisible();
    expect(await shellKept(page)).toBe(true);
  });

  test("reduced motion swaps the form without animating", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const frames = await probeNextTransition(page);
    await page.getByRole("navigation", { name: "Account" }).getByRole("link", { name: "Sign Up" }).click();
    for (const f of await frames()) expect(f.end, f.pseudo).toBe(0);
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByLabel("Full name")).toBeVisible();
  });

  // Next restores history synchronously, outside a React transition, so Back/Forward swap without animating
  test("Back and Forward restore the right form and leave focus usable", async ({ page }) => {
    const tabs = page.getByRole("navigation", { name: "Account" });
    await tabs.getByRole("link", { name: "Sign Up" }).click();
    await expect(page.getByLabel("Full name")).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Welcome back!" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Sign In" })).toHaveAttribute("aria-current", "page");

    // focus never stays on a removed element, and the next Tab continues inside the card (the browser
    // resumes from where the old tab link was, so it lands on the first field)
    expect(await page.evaluate(() => document.activeElement?.isConnected)).toBe(true);
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest(".auth-card"))).toBe(true);

    await page.goForward();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByLabel("Full name")).toBeVisible();
  });

  test("keyboard: Enter on a tab switches forms and the new form is reachable", async ({ page }) => {
    const tabs = page.getByRole("navigation", { name: "Account" });
    await tabs.getByRole("link", { name: "Sign Up" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/signup$/);
    await page.getByLabel("Full name").focus();
    for (const label of ["Email", "Password"]) {
      await page.keyboard.press("Tab");
      await expect(page.getByLabel(label, { exact: true })).toBeFocused();
    }
  });
});

test("a tab clicked before the prefetch lands never shows an empty card", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  // slow network for router requests (prefetch and navigation), so the click beats the prefetch
  await page.route("**/*", async (route) => {
    if (route.request().headers()["rsc"]) await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back!" })).toBeVisible();
  // every painted frame: the card shows a heading and the tabs, never only a fallback; and the late commit still slides
  type Probe = { __empty: number; __frames: number; __slid: boolean };
  await page.evaluate(() => {
    const w = window as unknown as Probe;
    w.__empty = w.__frames = 0;
    w.__slid = false;
    const tick = () => {
      w.__frames++;
      if (!document.querySelector(".auth-card h1") || !document.querySelector(".auth-card nav")) w.__empty++;
      w.__slid ||= document.getAnimations().some((a) => (a as CSSAnimation).animationName === "auth-in");
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.getByRole("navigation", { name: "Account" }).getByRole("link", { name: "Sign Up" }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByLabel("Full name")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as Probe).__slid), { message: "form slid in" }).toBe(true);
  const { empty, frames } = await page.evaluate(() => {
    const w = window as unknown as Probe;
    return { empty: w.__empty, frames: w.__frames };
  });
  expect(frames).toBeGreaterThan(30); // the click really waited on the slow network
  expect(empty, "frames with an empty card").toBe(0);
});

test("mobile tabs switch between sign in and sign up", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/login");
  const tabs = page.getByRole("navigation", { name: "Account" });
  await tabs.getByRole("link", { name: "Sign Up" }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(tabs.getByRole("link", { name: "Sign Up" })).toHaveAttribute("aria-current", "page");
  await tabs.getByRole("link", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("long unbroken text in the card wraps instead of widening the page", async ({ page }) => {
  // the check-your-email screen echoes the submitted address back
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/login");
  await page.locator(".auth-card header p").evaluate((p) => (p.textContent = `${"a".repeat(80)}@${"b".repeat(60)}.studio`));
  await page.locator("form").first().evaluate((f) => f.insertAdjacentHTML("beforebegin", `<p role="alert">${"x".repeat(200)}</p>`));
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test("200% zoom keeps the page inside the viewport", async ({ browser }) => {
  // 1280px laptop at 200% zoom is a 640 CSS px viewport at 2x density
  const page = await browser.newPage({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 });
  for (const path of ["/login", "/signup"]) {
    await page.goto(path);
    expect(await overflow(page), path).toBeLessThanOrEqual(0);
    const google = page.getByRole("button", { name: "Continue with Google" });
    await google.scrollIntoViewIfNeeded();
    await expect(google).toBeInViewport();
  }
  await page.close();
});
