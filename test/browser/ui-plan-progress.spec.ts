import { test, expect } from "@playwright/test";
import type { UiPlanProgressV1 } from "../../src/ui/ports/campaign-read.js";
import { attachLoopbackNetworkGuard, launchUiFixture } from "./support/launch-ui.js";

test("campaign detail renders controller-observed plan progress ledger", async ({ page }) => {
  const ui = await launchUiFixture({
    campaignId: "C-1",
    campaigns: {
      "C-1": { repositoryId: "repo-1", envelopeDigest: "sha256:abc", status: "running" },
    },
  });
  const network = attachLoopbackNetworkGuard(page, ui.baseUrl);

  await page.goto(ui.campaignDetailUrl);
  await expect(page.getByRole("heading", { name: "Campaign C-1" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Plan progress" })).toBeVisible();
  await expect(page.getByText("Campaign supervisor orchestration and crash recovery")).toBeVisible();
  await expect(page.getByText("Worker reported").first()).toBeVisible();
  await expect(page.getByText("Controller reviewed")).toHaveCount(0);
  await expect(page.getByText("Completion authority: controller")).toBeVisible();

  network.assertLoopbackOnly();
  await ui.close();
});

test("renders hostile plan progress text as inert text", async ({ page }) => {
  const hostileLabel = "\u202E<script>alert(1)</script>\u202D";
  const hostilePath = '"><img src=x onerror=alert(1)>';

  const ui = await launchUiFixture({
    campaignId: "C-1",
    campaigns: {
      "C-1": { repositoryId: "repo-1", envelopeDigest: "sha256:abc", status: "running" },
    },
  });
  const network = attachLoopbackNetworkGuard(page, ui.baseUrl);
  let dialogOpened = false;
  page.on("dialog", () => {
    dialogOpened = true;
  });

  await page.route("**/api/v1/tasks/QK-1/plan-progress?campaignId=C-1", async (route) => {
    const response = await route.fetch();
    const projection = (await response.json()) as UiPlanProgressV1;
    projection.execution.agentLabel = hostileLabel;
    projection.plan.path = hostilePath;
    projection.plan.taskTitle = hostileLabel;
    await route.fulfill({
      status: response.status(),
      headers: response.headers(),
      contentType: "application/json",
      body: JSON.stringify(projection),
    });
  });

  await page.goto(ui.campaignDetailUrl);
  await expect(page.getByRole("heading", { name: "Plan progress" })).toBeVisible();
  await expect(page.getByText(hostileLabel).first()).toBeVisible();
  await expect(page.getByText(hostilePath).first()).toBeVisible();

  const markup = await page.evaluate(() => document.documentElement.innerHTML);
  expect(markup).not.toMatch(/<script[^>]*>alert\(1\)/i);
  expect(markup).not.toMatch(/<img[^>]*onerror/i);
  expect(dialogOpened).toBe(false);

  network.assertLoopbackOnly();
  await ui.close();
});

test("plan progress API requires viewer bearer", async ({ page }) => {
  const ui = await launchUiFixture({
    campaignId: "C-1",
    campaigns: {
      "C-1": { repositoryId: "repo-1", envelopeDigest: "sha256:abc", status: "running" },
    },
    includeTokens: false,
  });
  const network = attachLoopbackNetworkGuard(page, ui.baseUrl);
  await page.goto(`${ui.baseUrl}/campaigns/C-1`);

  const status = await page.evaluate(async () => {
    const response = await fetch("/api/v1/tasks/QK-1/plan-progress?campaignId=C-1", {
      headers: { Accept: "application/json" },
      credentials: "omit",
      cache: "no-store",
    });
    return response.status;
  });
  expect(status).toBe(401);

  network.assertLoopbackOnly();
  await ui.close();
});
