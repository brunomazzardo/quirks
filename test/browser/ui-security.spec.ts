import { test, expect, type Page } from "@playwright/test";
import { queryKeys } from "../../src/ui/client/query-options.js";
import {
  attachLoopbackNetworkGuard,
  assertClientStateFreeOfCredentials,
  launchUiFixture,
} from "./support/launch-ui.js";

function sameOriginHeaders(page: Page) {
  return page.evaluate(() => ({
    Origin: window.location.origin,
    Host: window.location.host,
    "Sec-Fetch-Site": "same-origin",
  }));
}

test("approval page has no-store response and nonce CSP", async ({ page }) => {
  const ui = await launchUiFixture();
  const network = attachLoopbackNetworkGuard(page, ui.baseUrl);
  const response = await page.goto(ui.preflightUrl);
  expect(response?.headers()["cache-control"]).toBe("no-store");
  expect(response?.headers()["content-security-policy"]).toMatch(/script-src 'nonce-/);
  expect(response?.headers()["content-security-policy"]).toMatch(/frame-ancestors 'none'/);
  network.assertLoopbackOnly();
  await ui.close();
});

test("strips split fragment credentials immediately after boot", async ({ page }) => {
  const ui = await launchUiFixture();
  const network = attachLoopbackNetworkGuard(page, ui.baseUrl);
  await page.goto(ui.preflightUrl);
  await expect(page.getByRole("heading", { name: "Preflight proposal" })).toBeVisible();

  const location = await page.evaluate(() => ({
    hash: window.location.hash,
    href: window.location.href,
    pathname: window.location.pathname,
  }));
  expect(location.hash).toBe("");
  expect(location.href).not.toContain("viewToken");
  expect(location.href).not.toContain("approvalToken");
  expect(location.pathname).toBe(`/preflight/${ui.campaignId}`);

  await assertClientStateFreeOfCredentials(page, [ui.viewerToken, ui.approvalToken]);
  network.assertLoopbackOnly();
  await ui.close();
});

test("rejects unauthenticated reads in the browser", async ({ page }) => {
  const ui = await launchUiFixture({ includeTokens: false });
  const network = attachLoopbackNetworkGuard(page, ui.baseUrl);
  const bootErrors: string[] = [];
  page.on("pageerror", (error) => bootErrors.push(error.message));
  await page.goto(`${ui.baseUrl}/preflight/${ui.campaignId}`);
  expect(bootErrors.some((message) => /viewToken must appear exactly once/i.test(message))).toBe(true);
  network.assertLoopbackOnly();
  await ui.close();
});

test("rejects approval credential used as bearer", async ({ page }) => {
  const ui = await launchUiFixture();
  const network = attachLoopbackNetworkGuard(page, ui.baseUrl);
  await page.goto(ui.preflightUrl);
  await expect(page.getByRole("heading", { name: "Preflight proposal" })).toBeVisible();

  const status = await page.evaluate(async (approvalToken) => {
    const response = await fetch("/api/v1/existing-tasks", {
      headers: {
        Authorization: `Bearer ${approvalToken}`,
        Accept: "application/json",
      },
      credentials: "omit",
      cache: "no-store",
    });
    return response.status;
  }, ui.approvalToken);
  expect(status).toBe(401);
  network.assertLoopbackOnly();
  await ui.close();
});

test("rejects viewer credential used as approval body token", async ({ page }) => {
  const ui = await launchUiFixture();
  const network = attachLoopbackNetworkGuard(page, ui.baseUrl);
  await page.goto(ui.preflightUrl);
  await expect(page.getByRole("heading", { name: "Preflight proposal" })).toBeVisible();

  const body = await page.evaluate(
    async ({ viewerToken, campaignId }) => {
      const response = await fetch("/api/v1/approval", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${viewerToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "omit",
        cache: "no-store",
        body: JSON.stringify({
          schemaVersion: 1,
          campaignId,
          envelopeDigest: "sha256:preflight-digest",
          approvalToken: viewerToken,
        }),
      });
      return response.json();
    },
    { viewerToken: ui.viewerToken, campaignId: ui.campaignId },
  );
  expect(body).toEqual({ schemaVersion: 1, result: "invalid" });
  network.assertLoopbackOnly();
  await ui.close();
});

test("surfaces stale digest approval without mutating", async ({ page }) => {
  const ui = await launchUiFixture();
  const network = attachLoopbackNetworkGuard(page, ui.baseUrl);
  await page.goto(ui.preflightUrl);
  await expect(page.getByRole("heading", { name: "Preflight proposal" })).toBeVisible();

  const before = ui.server.approvePortCalls;
  await ui.clickApprove(page);
  await expect(page.getByRole("status").filter({ hasText: /stale/i })).toBeVisible();
  expect(ui.server.approvePortCalls).toBe(before);
  network.assertLoopbackOnly();
  await ui.close();
});

test("rejects replay after approval and keeps viewer reads working", async ({ page }) => {
  const ui = await launchUiFixture({
    now: "2026-07-21T12:00:00.000Z",
  });
  const network = attachLoopbackNetworkGuard(page, ui.baseUrl);

  await page.route(`**/api/v1/campaigns/${ui.campaignId}/preflight`, async (route) => {
    const response = await route.fetch();
    const proposal = (await response.json()) as {
      envelopeDigest: string;
      approval: { campaignId: string; envelopeDigest: string };
    };
    proposal.envelopeDigest = "sha256:abc";
    proposal.approval = { campaignId: ui.campaignId, envelopeDigest: "sha256:abc" };
    await route.fulfill({
      status: response.status(),
      headers: response.headers(),
      contentType: "application/json",
      body: JSON.stringify(proposal),
    });
  });

  await page.goto(ui.preflightUrl);
  await expect(page.getByRole("heading", { name: "Preflight proposal" })).toBeVisible();
  await ui.clickApprove(page);
  await expect(page.getByRole("status").filter({ hasText: /approved/i })).toBeVisible();

  const replay = await page.evaluate(
    async ({ viewerToken, approvalToken, campaignId }) => {
      const response = await fetch("/api/v1/approval", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${viewerToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "omit",
        cache: "no-store",
        body: JSON.stringify({
          schemaVersion: 1,
          campaignId,
          envelopeDigest: "sha256:abc",
          approvalToken,
        }),
      });
      return response.json();
    },
    {
      viewerToken: ui.viewerToken,
      approvalToken: ui.approvalToken,
      campaignId: ui.campaignId,
    },
  );
  expect(replay).toEqual({ schemaVersion: 1, result: "replay" });

  await page.getByRole("link", { name: "Campaigns" }).click();
  await expect(page.getByRole("heading", { name: "Campaigns" })).toBeVisible();
  network.assertLoopbackOnly();
  await ui.close();
});

test("expires viewer session after eight hours of idle time", async ({ page }) => {
  const ui = await launchUiFixture({ now: "2026-07-21T12:00:00.000Z" });
  const network = attachLoopbackNetworkGuard(page, ui.baseUrl);
  await page.goto(ui.preflightUrl);
  await expect(page.getByRole("heading", { name: "Preflight proposal" })).toBeVisible();

  ui.setClock("2026-07-21T20:00:00.001Z");
  await page.getByRole("link", { name: "Campaigns" }).click();
  await expect(page.getByRole("alert")).toContainText(/unable to load campaigns/i);
  network.assertLoopbackOnly();
  await ui.close();
});

test("does not extend absolute expiry under repeated reads", async ({ page }) => {
  const ui = await launchUiFixture({ now: "2026-07-21T00:00:00.000Z" });
  const network = attachLoopbackNetworkGuard(page, ui.baseUrl);
  await page.goto(ui.preflightUrl);
  await expect(page.getByRole("heading", { name: "Preflight proposal" })).toBeVisible();

  ui.setClock("2026-07-21T07:00:00.000Z");
  await page.getByRole("link", { name: "Campaigns" }).click();
  await expect(page.getByRole("heading", { name: "Campaigns" })).toBeVisible();

  ui.setClock("2026-07-21T14:00:00.000Z");
  await page.getByRole("link", { name: "Existing tasks" }).click();
  await expect(page.getByRole("heading", { name: "Existing tasks" })).toBeVisible();

  ui.setClock("2026-07-21T21:00:00.000Z");
  await page.getByRole("link", { name: "Campaigns" }).click();
  await expect(page.getByRole("heading", { name: "Campaigns" })).toBeVisible();

  ui.setClock("2026-07-22T00:00:00.001Z");
  const expiredStatus = await page.evaluate(async (viewerToken) => {
    const response = await fetch("/api/v1/existing-tasks", {
      headers: {
        Authorization: `Bearer ${viewerToken}`,
        Accept: "application/json",
      },
      credentials: "omit",
      cache: "no-store",
    });
    return response.status;
  }, ui.viewerToken);
  expect(expiredStatus).toBe(401);

  await page.waitForTimeout(5_100);
  await page.getByRole("link", { name: "Existing tasks" }).click();
  await expect(page.getByRole("alert")).toContainText(/unable to load existing tasks/i);
  network.assertLoopbackOnly();
  await ui.close();
});

test("renders hostile task and progress text as inert text", async ({ page }) => {
  const hostileTitle = "\u202E<script>alert(1)</script>\u202D";
  const hostileProgress = '"><img src=x onerror=alert(1)>';

  const ui = await launchUiFixture();
  const network = attachLoopbackNetworkGuard(page, ui.baseUrl);
  let dialogOpened = false;
  page.on("dialog", () => {
    dialogOpened = true;
  });

  await page.route(`**/api/v1/campaigns/${ui.campaignId}/preflight`, async (route) => {
    const response = await route.fetch();
    const proposal = (await response.json()) as {
      tasks: Array<{ taskId: string; title: string; waveId: string; laneId: string }>;
      inspector: { acceptanceProof: string };
    };
    const baseTask = proposal.tasks[0] ?? {
      taskId: "QK-1",
      title: "Delegated design task",
      waveId: "wave-1",
      laneId: "lane-1",
    };
    proposal.tasks[0] = { ...baseTask, title: hostileTitle };
    proposal.inspector.acceptanceProof = hostileProgress;
    await route.fulfill({
      status: response.status(),
      headers: response.headers(),
      contentType: "application/json",
      body: JSON.stringify(proposal),
    });
  });

  await page.goto(ui.preflightUrl);
  await expect(page.getByRole("heading", { name: "Preflight proposal" })).toBeVisible();
  await expect(page.getByText(hostileTitle)).toBeVisible();
  await expect(page.getByText(hostileProgress).first()).toBeVisible();

  const markup = await page.evaluate(() => document.documentElement.innerHTML);
  expect(markup).not.toMatch(/<script[^>]*>alert\(1\)/i);
  expect(markup).not.toMatch(/<img[^>]*onerror/i);
  expect(dialogOpened).toBe(false);

  const bodyScripts = await page.evaluate(() => document.body.querySelectorAll("script").length);
  expect(bodyScripts).toBe(1);
  network.assertLoopbackOnly();
  await ui.close();
});

test("keeps history, search, and storage free of credentials", async ({ page }) => {
  const ui = await launchUiFixture();
  const network = attachLoopbackNetworkGuard(page, ui.baseUrl);
  await page.goto(ui.preflightUrl);
  await expect(page.getByRole("heading", { name: "Preflight proposal" })).toBeVisible();
  await page.getByRole("link", { name: "Campaigns" }).click();
  await expect(page.getByRole("heading", { name: "Campaigns" })).toBeVisible();

  await assertClientStateFreeOfCredentials(page, [ui.viewerToken, ui.approvalToken]);
  network.assertLoopbackOnly();
  await ui.close();
});

test("keeps TanStack Query keys bounded without credentials or digests", async ({ page }) => {
  const serialized = JSON.stringify([
    queryKeys.existingTasks(),
    queryKeys.preflight("C-1"),
    queryKeys.campaigns(),
    queryKeys.campaignDetail("C-1"),
    queryKeys.taskHistory("QK-1"),
  ]);
  expect(serialized).not.toMatch(/token|digest|qkview_|qkapprove_/i);

  const ui = await launchUiFixture();
  const network = attachLoopbackNetworkGuard(page, ui.baseUrl);
  await page.goto(ui.preflightUrl);
  await expect(page.getByRole("heading", { name: "Preflight proposal" })).toBeVisible();
  await assertClientStateFreeOfCredentials(page, [ui.viewerToken, ui.approvalToken, "sha256:"]);
  network.assertLoopbackOnly();
  await ui.close();
});

test("ships without router or query devtools or debug globals", async ({ page }) => {
  const ui = await launchUiFixture();
  const network = attachLoopbackNetworkGuard(page, ui.baseUrl);
  await page.goto(ui.preflightUrl);
  await expect(page.getByRole("heading", { name: "Preflight proposal" })).toBeVisible();

  const globals = await page.evaluate(() =>
    Object.keys(window).filter((key) => /tanstack|reactquery|__REACT_DEVTOOLS|__REDUX_DEVTOOLS/i.test(key)),
  );
  expect(globals).toEqual([]);

  const scriptSrc = await page.evaluate(() =>
    Array.from(document.querySelectorAll("script")).map((node) => node.getAttribute("src") ?? "inline"),
  );
  expect(scriptSrc).toEqual(["inline"]);
  network.assertLoopbackOnly();
  await ui.close();
});
