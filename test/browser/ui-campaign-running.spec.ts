import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { test, expect } from "@playwright/test";
import { attachLoopbackNetworkGuard, launchUiFixture } from "./support/launch-ui.js";

const execFileAsync = promisify(execFile);

type OpenWorkspaceModule = typeof import("../../src/ui/open-workspace.js");
type ProjectConfigModule = typeof import("../../src/project/config.js");

async function importCompiled<T>(relativePath: string): Promise<T> {
  return (await import(pathToFileURL(path.resolve(relativePath)).href)) as T;
}

async function createFixtureProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-ui-running-project-"));
  await cp(path.resolve("test/fixtures/json-project"), root, { recursive: true });
  await execFileAsync("git", ["init", root]);
  return root;
}

/**
 * Durable store of a live RUNNING campaign, shapes mirrored from a real
 * execution: status "running" with activeLanes, no spend/outcome, a recorded
 * approval bound to the state digest, empty sessions and progress journals.
 */
async function seedRunningCampaign(
  stateDir: string,
  repositoryId: string,
  campaignId: string,
): Promise<void> {
  const campaignDir = path.join(
    stateDir,
    "repositories",
    repositoryId.replaceAll(":", "-"),
    "campaigns",
    campaignId,
  );
  await mkdir(campaignDir, { recursive: true });
  const digest = `sha256:${"1b".repeat(32)}`;
  await writeFile(
    path.join(campaignDir, "campaign.json"),
    JSON.stringify({
      schemaVersion: 1,
      campaignId,
      repositoryId,
      createdAt: "2026-07-23T20:01:29.237Z",
      taskIds: ["QK-1"],
      git: { baseCommit: "5a73ab834e39870ae19fd02c798f75fd977d0144" },
    }),
  );
  await writeFile(
    path.join(campaignDir, "state.json"),
    JSON.stringify({
      schemaVersion: 1,
      campaignId,
      status: "running",
      digest,
      activeLanes: ["lane-a"],
      updatedAt: "2026-07-23T20:04:13.715Z",
    }),
  );
  await writeFile(
    path.join(campaignDir, "approvals.jsonl"),
    `${JSON.stringify({
      schemaVersion: 1,
      campaignId,
      digest,
      approvedAt: "2026-07-23T20:01:59.987Z",
      operator: { kind: "self-asserted", id: "quirks-campaign-cli" },
      tokenId: "9".repeat(64),
      evidence: { channel: "headless" },
    })}\n`,
  );
  await writeFile(path.join(campaignDir, "sessions.json"), JSON.stringify({ schemaVersion: 1, sessions: [] }));
  await writeFile(path.join(campaignDir, "progress.jsonl"), "");
}

test("campaign-bound workspace renders a RUNNING campaign without crashing", async ({ page }) => {
  process.env.QUIRKS_STATE_DIR ??= await mkdtemp(path.join(os.tmpdir(), "quirks-ui-running-env-"));
  const repositoryRoot = await createFixtureProject();
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-ui-running-state-"));

  const { loadProjectContext } = await importCompiled<ProjectConfigModule>("dist/src/project/config.js");
  const { openWorkspace } = await importCompiled<OpenWorkspaceModule>("dist/src/ui/open-workspace.js");
  const context = await loadProjectContext(repositoryRoot, { mode: "inspection" });
  await seedRunningCampaign(stateDir, context.repositoryId, "C-run");

  const workspace = await openWorkspace({
    campaignId: "C-run",
    repositoryRoot,
    stateDir,
    ports: "production",
    deps: { json: true, isTty: false },
  });
  const network = attachLoopbackNetworkGuard(page, workspace.authority);
  try {
    // A running campaign lands on the campaign detail route.
    expect(new URL(workspace.launchUrl).pathname).toBe("/campaigns/C-run");
    await page.goto(workspace.launchUrl);

    // Live truth from the durable store, not a crashed boundary.
    await expect(page.getByRole("heading", { name: "Campaign C-run" })).toBeVisible();
    await expect(page.getByText("Something went wrong.")).toHaveCount(0);
    await expect(page.locator(".workspace-header .status-badge")).toContainText("Running");
    await expect(page.getByText("QK-1", { exact: true })).toBeVisible();
    await expect(page.getByText("Contract task")).toBeVisible();

    // Absent execution data renders as explicit empty states, never invented.
    await expect(page.getByText("No waves.")).toBeVisible();
    await expect(page.getByText("No commits.")).toBeVisible();
    await expect(page.getByText("No pull requests.")).toBeVisible();
    await expect(page.getByText("No verification results.")).toBeVisible();
    await expect(page.getByText("Pending", { exact: true })).toBeVisible();

    // A running campaign has no state-valid copy prompt: the empty prompt set
    // renders as no actions, and the request must not surface as a failure.
    await expect(page.getByRole("button", { name: /Copy .* prompt/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "More prompts" })).toHaveCount(0);
  } finally {
    network.assertLoopbackOnly();
    await workspace.close?.();
  }
});

test("standard fixture set renders the RUNNING campaign detail everywhere", async ({ page }) => {
  const ui = await launchUiFixture();
  const network = attachLoopbackNetworkGuard(page, ui.baseUrl);

  await page.goto(ui.viewerUrl("/campaigns/C-running"));
  await expect(page.getByRole("heading", { name: "Campaign C-running" })).toBeVisible();
  await expect(page.getByText("Something went wrong.")).toHaveCount(0);
  await expect(page.locator(".workspace-header .status-badge")).toContainText("Running");

  // Claimed ledger tasks render as recorded.
  await expect(page.getByText("QK-1", { exact: true })).toBeVisible();
  await expect(page.getByText("Follow-up task")).toBeVisible();

  // Sparse live sections are explicit, and plan progress reports unavailable
  // instead of fabricating a plan.
  await expect(page.getByText("No waves.")).toBeVisible();
  await expect(page.getByText("No commits.")).toBeVisible();
  await expect(page.getByText("No plan progress recorded for this campaign.")).toBeVisible();

  // The RUNNING campaign context serves an explicit empty prompt set.
  await expect(page.getByRole("button", { name: /Copy .* prompt/ })).toHaveCount(0);

  network.assertLoopbackOnly();
  await ui.close();
});
