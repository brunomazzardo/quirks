import { test, expect, type Page } from "@playwright/test";
import {
  attachLoopbackNetworkGuard,
  assertClientStateFreeOfCredentials,
  launchUiFixture,
  type UiFixture,
} from "./support/launch-ui.js";

function taskHistoryUrl(ui: UiFixture, taskId: string): string {
  return `${ui.baseUrl}/tasks/${taskId}/history#viewToken=${encodeURIComponent(ui.viewerToken)}`;
}

function campaignDetailUrl(ui: UiFixture, campaignId: string): string {
  return `${ui.baseUrl}/campaigns/${campaignId}#viewToken=${encodeURIComponent(ui.viewerToken)}`;
}

async function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("preflight awaiting approval defaults to plan review with one-click copy", async ({ page }) => {
  const ui = await launchUiFixture();
  const network = attachLoopbackNetworkGuard(page, ui.baseUrl);
  const response = await page.goto(ui.preflightUrl);
  expect(response?.headers()["content-security-policy"]).toMatch(/script-src 'nonce-/);

  const primary = page.getByRole("button", { name: "Copy plan review prompt" });
  await expect(primary).toBeVisible();
  await expect(primary).toBeEnabled();
  await primary.click();
  await expect(page.getByRole("status").filter({ hasText: "Copied" })).toBeVisible();
  const copied = await readClipboard(page);
  expect(copied).toContain("Objective: Review the preflight proposal for campaign C-1");
  expect(copied).toContain("Required skills:");
  expect(copied).toContain("read-only");

  await assertClientStateFreeOfCredentials(page, [ui.viewerToken, ui.approvalToken]);
  network.assertLoopbackOnly();
  await ui.close();
});

test("approved not-started campaign defaults to the start recipe", async ({ page }) => {
  const ui = await launchUiFixture();
  const network = attachLoopbackNetworkGuard(page, ui.baseUrl);
  await page.goto(campaignDetailUrl(ui, "C-approved"));

  const primary = page.getByRole("button", { name: "Copy start campaign prompt" });
  await expect(primary).toBeVisible();
  await primary.click();
  const copied = await readClipboard(page);
  expect(copied).toContain("Start approved campaign C-approved");
  expect(copied).toContain("Recovery rule:");
  expect(copied).toContain("quirks-campaign start --campaign C-approved --json");

  network.assertLoopbackOnly();
  await ui.close();
});

test("review-ready task exposes state-valid alternatives and preview metadata", async ({ page }) => {
  const ui = await launchUiFixture();
  const network = attachLoopbackNetworkGuard(page, ui.baseUrl);
  await page.goto(taskHistoryUrl(ui, "QK-1"));

  const primary = page.getByRole("button", { name: "Copy review prompt", exact: true });
  await expect(primary).toBeVisible();

  await page.getByRole("button", { name: "More prompts" }).click();
  await expect(page.getByRole("menuitem", { name: "Copy adversarial review prompt", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Start campaign/ })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: /Continue task/ })).toHaveCount(0);

  await page.getByRole("menuitem", { name: "Preview Copy adversarial review prompt" }).click();
  const dialog = page.locator("dialog.prompt-preview");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("adversarial-task-review");
  await expect(dialog).toContainText("v1");
  await expect(dialog).toContainText("claude-opus");
  await expect(dialog).toContainText("independent from codex-gpt");
  await expect(dialog).toContainText("Bindings");
  await expect(dialog).toContainText("Objective: Review the changes for task QK-1");

  await dialog.getByRole("button", { name: "Copy this prompt" }).click();
  const copied = await readClipboard(page);
  expect(copied).toContain("Independent-review rule:");
  expect(copied).toContain("Challenge both the implementation and prior review conclusions.");

  await dialog.getByRole("button", { name: "Close preview" }).click();
  await expect(page.locator("dialog.prompt-preview")).toHaveCount(0);

  network.assertLoopbackOnly();
  await ui.close();
});

test("clipboard failure reveals an accessible selectable fallback", async ({ page }) => {
  const ui = await launchUiFixture();
  const network = attachLoopbackNetworkGuard(page, ui.baseUrl);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: () => Promise.reject(new Error("clipboard unavailable")),
      },
      configurable: true,
    });
  });
  await page.goto(taskHistoryUrl(ui, "QK-1"));

  await page.getByRole("button", { name: "Copy review prompt", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /Copy failed/ })).toBeVisible();
  const fallback = page.getByLabel("Prompt text");
  await expect(fallback).toBeVisible();
  await expect(fallback).toHaveAttribute("readonly", "");
  const value = await fallback.inputValue();
  expect(value).toContain("Objective: Review the changes for task QK-1");

  network.assertLoopbackOnly();
  await ui.close();
});

test("prompt text never enters URL, router search, or persistent storage", async ({ page }) => {
  const ui = await launchUiFixture();
  const network = attachLoopbackNetworkGuard(page, ui.baseUrl);
  await page.goto(taskHistoryUrl(ui, "QK-1"));

  await page.getByRole("button", { name: "Copy review prompt", exact: true }).click();
  await page.getByRole("button", { name: "More prompts" }).click();
  await page.getByRole("menuitem", { name: "Preview Copy review prompt", exact: true }).click();
  await expect(page.locator("dialog.prompt-preview")).toBeVisible();

  const snapshot = await page.evaluate(() => ({
    href: window.location.href,
    search: window.location.search,
    hash: window.location.hash,
    historyState: JSON.stringify(history.state),
    localStorage: JSON.stringify(localStorage),
    sessionStorage: JSON.stringify(sessionStorage),
    cookies: document.cookie,
  }));
  for (const surface of Object.values(snapshot)) {
    expect(surface).not.toContain("Objective:");
    expect(surface).not.toContain("UNTRUSTED EVIDENCE");
  }
  expect(snapshot.localStorage).toBe("{}");
  expect(snapshot.sessionStorage).toBe("{}");

  network.assertLoopbackOnly();
  await ui.close();
});
