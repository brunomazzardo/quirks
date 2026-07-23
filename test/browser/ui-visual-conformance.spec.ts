import { test, expect, type Page } from "@playwright/test";
import {
  CONFORMANCE_RULES,
  launchConformanceUi,
  screenshotOptions,
  type ConformanceUi,
} from "./support/visual-conformance.js";

/**
 * QK-VIS-003 visual-conformance gate (plan Task 5).
 *
 * Per reference and viewport this spec asserts the governed structural
 * decisions FIRST — shell, stat strips, table+inspector composition, wave
 * map, fixed approval footer, and the 900px/620px breakpoints — and only
 * then compares a screenshot against the committed baseline, so a baseline
 * update can never hide missing composition. Reproduction rules live in
 * test/ui/fixtures/visual-conformance-rules.json; accepted divergences from
 * the mocks are pinned as explicit absence assertions, not silently skipped.
 */

const VIEWPORTS = [
  { name: "desktop" as const, size: CONFORMANCE_RULES.viewports.desktop },
  { name: "compact" as const, size: CONFORMANCE_RULES.viewports.compact },
];

async function gridColumnCount(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((element) => {
    return getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length;
  });
}

/** Shared shell: dark #111827 nav over the light #f3f6fa canvas, real route set only. */
async function assertShell(page: Page): Promise<void> {
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav).toBeVisible();
  await expect(nav.locator(".brand")).toHaveText("Quirks");
  await expect(nav).toHaveCSS("background-color", "rgb(17, 24, 39)");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(243, 246, 250)");
  // Five-view contract: no dead "Runner health" / "New campaign" items (handoff §6.C/§6.D).
  await expect(nav.locator(".nav-links a")).toHaveText(["Existing tasks", "Campaigns"]);
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
}

/** Wide inner content must scroll inside its own container, never the page. */
async function assertScrollsInside(page: Page, selector: string, viewport: "desktop" | "compact"): Promise<void> {
  const container = page.locator(selector).first();
  await expect(container).toHaveCSS("overflow-x", "auto");
  if (viewport === "compact") {
    const scrollable = await container.evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(scrollable).toBe(true);
  }
}

for (const viewport of VIEWPORTS) {
  const workspaceColumns = viewport.name === "desktop" ? 2 : 1;
  const summaryColumns = viewport.name === "desktop" ? 5 : 2;

  test(`preflight follows the approved v3 composition at ${viewport.name}`, async ({ page }) => {
    const ui = await launchConformanceUi();
    await page.setViewportSize(viewport.size);
    await page.goto(ui.preflightUrl);
    await expect(page.getByRole("heading", { level: 1, name: /Preflight proposal · C-1/ })).toBeVisible();

    await assertShell(page);
    // v3 hierarchy: identity first, safety statement second, metrics third.
    await expect(page.locator(".workspace-header .micro-label").first()).toHaveText("PREFLIGHT · PROPOSAL ONLY");
    await expect(page.locator(".workspace-notice--info")).toContainText("Nothing has started.");
    await expect(page.locator(".summary-grid").first().locator(".summary-stat")).toHaveCount(5);
    expect(await gridColumnCount(page, ".summary-grid")).toBe(summaryColumns);

    // v3 workspace: map panel + inspector aside, stacking to one column ≤900px.
    expect(await gridColumnCount(page, ".workspace-layout")).toBe(workspaceColumns);
    await expect(page.locator(".wave-map .wave-col")).toHaveCount(4);
    await assertScrollsInside(page, ".wave-map-scroll", viewport.name);
    await expect(page.locator(".workspace-inspector")).toContainText("SELECTED TASK · QK-104");

    // Complete task list: nothing hidden by the visual map; scrolls in-panel.
    await expect(page.getByText("Complete task list")).toBeVisible();
    await expect(page.locator(".data-table-wrapper table tbody tr")).toHaveCount(6);
    await expect(page.locator(".data-table-wrapper").first()).toHaveCSS("overflow-x", "auto");

    // v3 fixed approval footer: digest plus the one irreversible action, body padding reserved.
    const footer = page.locator(".approval-footer");
    await expect(footer).toBeVisible();
    await expect(footer).toHaveCSS("position", "fixed");
    await expect(footer).toHaveCSS("bottom", "0px");
    await expect(footer.locator("#envelope-digest")).toBeVisible();
    await expect(footer.getByRole("button", { name: /approve campaign/i })).toBeDisabled();
    // v3 reserves body padding for the fixed footer: the reservation must be at
    // least as tall as the footer so it can never occlude end-of-page content.
    const footerHeight = (await footer.boundingBox())?.height ?? Number.POSITIVE_INFINITY;
    const reserved = await page
      .locator("article.preflight-view")
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingBottom));
    expect(reserved).toBeGreaterThanOrEqual(footerHeight);

    // Accepted deliberate omissions (rules fixture: no-dead-controls).
    await expect(page.getByRole("button", { name: "Edit routing" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Use current agent only" })).toHaveCount(0);

    await assertNoHorizontalOverflow(page);
    await expect(page).toHaveScreenshot(`preflight-${viewport.name}.png`, screenshotOptions());
    await ui.close();
  });

  test(`existing tasks follow the approved v4 composition at ${viewport.name}`, async ({ page }) => {
    const ui = await launchConformanceUi();
    await page.setViewportSize(viewport.size);
    await page.goto(ui.tasksUrl);
    await expect(page.getByRole("heading", { level: 1, name: "Existing tasks" })).toBeVisible();

    await assertShell(page);
    // v4 stat strip: counts before lists.
    const stats = page.locator(".summary-grid .summary-stat");
    await expect(stats).toHaveCount(5);
    await expect(stats).toContainText(["Open", "Ready", "Blocked", "Design gate", "In campaign"]);
    expect(await gridColumnCount(page, ".summary-grid")).toBe(summaryColumns);

    // v4 toolbar density: one row of search plus readiness chips.
    const toolbar = page.locator(".workspace-toolbar");
    await expect(toolbar.getByLabel("Search tasks")).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "Needs design" })).toBeVisible();
    if (viewport.name === "desktop") {
      await expect(toolbar.locator(".toolbar-note")).toBeVisible();
    } else {
      await expect(toolbar.locator(".toolbar-note")).toBeHidden();
    }

    // v4 frontier map: three dependency-depth columns, design gate tinted amber.
    await expect(page.locator(".frontier-map .wave-col-label")).toHaveText(["Foundations", "Next wave", "Later"]);
    await expect(page.locator(".mini-card--design")).toContainText("QK-201 · Needs design");
    await assertScrollsInside(page, ".frontier-scroll", viewport.name);

    // Table + inspector composition; selecting populates the aside without state changes.
    expect(await gridColumnCount(page, ".workspace-layout")).toBe(workspaceColumns);
    await expect(page.locator(".data-table-wrapper table tbody tr")).toHaveCount(7);
    await page.getByRole("button", { name: /QK-203/ }).click();
    const inspector = page.locator(".workspace-inspector");
    await expect(inspector).toContainText("SELECTED TASK · QK-203");
    await expect(inspector).toContainText("Why this route");
    await expect(inspector).toContainText("no task state changes from viewing or selecting");

    // Accepted deliberate omission: no selection→proposal flow exists server-side.
    await expect(page.getByRole("button", { name: "Build campaign proposal" })).toHaveCount(0);

    await assertNoHorizontalOverflow(page);
    await expect(page).toHaveScreenshot(`tasks-${viewport.name}.png`, screenshotOptions());
    await ui.close();
  });

  test(`campaigns follow the approved v4 composition at ${viewport.name}`, async ({ page }) => {
    const ui = await launchConformanceUi();
    await page.setViewportSize(viewport.size);
    await page.goto(ui.campaignsUrl);
    await expect(page.getByRole("heading", { level: 1, name: "Campaigns" })).toBeVisible();

    await assertShell(page);
    // v4 stat strip with the accepted "Recorded" fifth stat (no invented spend window).
    const campaignStats = page.locator(".summary-grid .summary-stat");
    await expect(campaignStats).toHaveCount(5);
    await expect(campaignStats).toContainText(["Active", "Paused", "Completed", "Held", "Recorded"]);
    await expect(page.locator(".summary-grid")).not.toContainText("30-day spend");
    expect(await gridColumnCount(page, ".summary-grid")).toBe(summaryColumns);

    // v4 active-campaign promotion above the history rows.
    const active = page.locator(".active-campaign");
    await expect(active).toBeVisible();
    await expect(active).toContainText("C-1");
    await expect(active.getByRole("link", { name: "Open live campaign" })).toBeVisible();

    // Table + inspector composition with the v4 immutability safety note.
    expect(await gridColumnCount(page, ".workspace-layout")).toBe(workspaceColumns);
    await expect(page.locator(".data-table-wrapper table tbody tr")).toHaveCount(3);
    await expect(page.locator(".workspace-inspector .safety-note")).toContainText("A past campaign is immutable");

    await assertNoHorizontalOverflow(page);
    await expect(page).toHaveScreenshot(`campaigns-${viewport.name}.png`, screenshotOptions());
    await ui.close();
  });

  test(`campaign detail reuses the shared primitives at ${viewport.name}`, async ({ page }) => {
    const ui = await launchConformanceUi();
    await page.setViewportSize(viewport.size);
    await page.goto(ui.campaignDetailUrl);
    await expect(page.getByRole("heading", { level: 1, name: "Campaign C-1" })).toBeVisible();

    await assertShell(page);
    // No governing wireframe (handoff §6.B): shared shell, summary, panel, and
    // wave-step primitives only — asserted so drift into ad-hoc composition fails.
    await expect(page.locator(".workspace-header .status-badge")).toContainText("Running");
    await expect(page.locator(".summary-grid[data-columns='4'] .summary-stat")).toHaveCount(4);
    expect(await gridColumnCount(page, ".summary-grid")).toBe(viewport.name === "desktop" ? 4 : 2);
    await expect(page.locator(".workspace-notice")).toContainText("A past campaign is immutable.");
    expect(await gridColumnCount(page, ".workspace-layout")).toBe(workspaceColumns);
    await expect(page.locator(".workspace-panel").filter({ hasText: "Tasks" }).first()).toBeVisible();
    await expect(page.locator(".wave-steps li")).toHaveCount(1);

    await assertNoHorizontalOverflow(page);
    await expect(page).toHaveScreenshot(`campaign-detail-${viewport.name}.png`, screenshotOptions());
    await ui.close();
  });

  test(`task history follows the approved v5 composition at ${viewport.name}`, async ({ page }) => {
    const ui = await launchConformanceUi();
    await page.setViewportSize(viewport.size);
    await page.goto(ui.taskHistoryUrl("QK-1"));
    await expect(page.getByRole("heading", { level: 1, name: /Task history · QK-1/ })).toBeVisible();

    await assertShell(page);
    // v5 outcome-first header: breadcrumb, badges, then stats.
    await expect(page.locator(".workspace-crumb")).toHaveText("Existing tasks / QK-1 / History and provenance");
    await expect(page.locator(".workspace-badges")).toContainText("2 iterations");
    await expect(page.locator(".workspace-notice--warning")).toContainText("Local coordination only.");
    await expect(page.locator(".summary-grid[data-columns='4'] .summary-stat")).toHaveCount(4);
    expect(await gridColumnCount(page, ".summary-grid")).toBe(viewport.name === "desktop" ? 4 : 2);

    // v5 governing-file cards: typed kind chips from real provenance kinds.
    const governing = page.locator(".workspace-panel").filter({ hasText: "Governing files" }).first();
    await expect(governing.locator(".artifact-kind[data-kind='spec']")).toHaveText("Superpowers spec");
    await expect(governing.locator(".artifact-kind[data-kind='plan']")).toHaveText("Implementation plan");
    await expect(governing.locator(".artifact-kind[data-kind='review']")).toHaveText("Independent review");
    expect(await gridColumnCount(page, ".artifact-cards")).toBe(viewport.name === "desktop" ? 3 : 1);

    // v5 iteration timeline: append-only cards, not exploded table rows.
    await expect(page.locator(".iteration-card")).toHaveCount(2);
    await expect(page.locator(".iteration-card .micro-label").first()).toHaveText("Iteration 1");

    // v5 identity and provenance rail with the self-assertion caveat.
    const rail = page.locator(".provenance-rail");
    await expect(rail).toBeVisible();
    await expect(rail.locator(".identity-list li").first()).toBeVisible();
    await expect(rail).toContainText("self-asserted unless a valid signature");

    expect(await gridColumnCount(page, ".workspace-layout")).toBe(workspaceColumns);
    await assertNoHorizontalOverflow(page);
    await expect(page).toHaveScreenshot(`task-history-${viewport.name}.png`, screenshotOptions());
    await ui.close();
  });
}

test("conformance fixture serves every surface declared in the reproduction rules", async () => {
  const ui: ConformanceUi = await launchConformanceUi();
  const routes = CONFORMANCE_RULES.surfaces.map((surface) => surface.route);
  expect(routes).toEqual(["/preflight/C-1", "/", "/campaigns", "/campaigns/C-1", "/tasks/QK-1/history"]);
  await ui.close();
});
