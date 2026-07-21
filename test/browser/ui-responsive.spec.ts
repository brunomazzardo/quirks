import { test, expect } from "@playwright/test";
import { VIEWPORTS } from "./support/viewports.js";
import { launchUiFixture } from "./support/launch-ui.js";

for (const viewport of VIEWPORTS) {
  test(`preflight layout fits ${viewport.name}`, async ({ page }) => {
    const ui = await launchUiFixture();
    await page.setViewportSize(viewport.size);
    await page.goto(ui.preflightUrl);
    await expect(page.getByRole("heading", { name: "Preflight proposal" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
    await ui.close();
  });
}
