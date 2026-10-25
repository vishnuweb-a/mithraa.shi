import { test, expect } from "@playwright/test";

// Responsive checks for the auth screens. Screenshots land in test-results/ and are copied to docs by hand.
const VIEWPORTS = [
  { name: "desktop", width: 1536, height: 1024 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "mobile", width: 390, height: 844 },
  { name: "small", width: 320, height: 640 },
];

for (const vp of VIEWPORTS) {
  for (const path of ["/login", "/signup"]) {
    test(`${path} at ${vp.name} ${vp.width}px`, async ({ page }, info) => {
      await page.setViewportSize(vp);
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
      // only Google: no decorative or dead provider buttons
      await expect(page.getByRole("button", { name: /apple|facebook|github/i })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), "horizontal overflow").toBeLessThanOrEqual(0);
      // touch targets
      for (const b of await page.locator("form button, input:not([type=hidden])").all()) {
        const box = await b.boundingBox();
        if (box) expect(box.height, await b.evaluate((e) => e.outerHTML.slice(0, 60))).toBeGreaterThanOrEqual(40);
      }
      await page.screenshot({ path: info.outputPath(`${path.slice(1)}-${vp.name}.png`), fullPage: true });
    });
  }
}
