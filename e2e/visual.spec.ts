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

test("laptop sign-in fits without scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/login");
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(800);
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
