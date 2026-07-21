import { test, expect } from "@playwright/test";
import { launchUiFixture } from "./support/launch-ui.js";

test("preflight exposes landmarks, labels, and focusable approval controls", async ({ page }) => {
  const ui = await launchUiFixture();
  await page.goto(ui.preflightUrl);
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Preflight proposal" })).toBeVisible();
  await expect(page.getByLabel(/filter tasks/i)).toBeVisible();
  await expect(page.getByLabel(/reviewed the preflight proposal/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /approve campaign/i })).toBeDisabled();
  await page.getByLabel(/reviewed the preflight proposal/i).focus();
  await expect(page.getByLabel(/reviewed the preflight proposal/i)).toBeFocused();
  await ui.close();
});

test("approval digest is associated with acknowledgement control", async ({ page }) => {
  const ui = await launchUiFixture();
  await page.goto(ui.preflightUrl);
  const digest = page.locator("#envelope-digest");
  await expect(digest).toBeVisible();
  const describedBy = await page.getByLabel(/reviewed the preflight proposal/i).getAttribute("aria-describedby");
  expect(describedBy).toContain("envelope-digest");
  await ui.close();
});

test("sync freshness uses role=status", async ({ page }) => {
  const ui = await launchUiFixture();
  await page.goto(ui.preflightUrl);
  await expect(page.getByRole("status").first()).toBeVisible();
  await ui.close();
});
