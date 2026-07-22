import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { test, expect, type Page } from "@playwright/test";
import { attachLoopbackNetworkGuard } from "./support/launch-ui.js";

const execFileAsync = promisify(execFile);

type OpenWorkspaceModule = typeof import("../../src/ui/open-workspace.js");

type StandaloneFixture = {
  authority: string;
  launchUrl: string;
  campaignDetailUrl: string;
  close: () => Promise<void>;
};

async function createFixtureProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-ui-standalone-project-"));
  await cp(path.resolve("test/fixtures/json-project"), root, { recursive: true });
  await execFileAsync("git", ["init", root]);
  return root;
}

async function seedHistoricalCampaign(stateDir: string, campaignId: string): Promise<void> {
  const campaignDir = path.join(stateDir, "repositories", "repo-fixture", "campaigns", campaignId);
  await mkdir(campaignDir, { recursive: true });
  await writeFile(
    path.join(campaignDir, "campaign.json"),
    JSON.stringify({
      schemaVersion: 1,
      campaignId,
      repositoryId: "sha256:repo-1",
      createdAt: "2026-07-20T09:00:00.000Z",
      taskIds: ["QK-1"],
    }),
  );
  await writeFile(
    path.join(campaignDir, "state.json"),
    JSON.stringify({
      schemaVersion: 1,
      campaignId,
      status: "complete",
      digest: "sha256:abc",
      updatedAt: "2026-07-20T15:00:00.000Z",
    }),
  );
}

async function launchStandaloneWorkspace(): Promise<StandaloneFixture> {
  process.env.QUIRKS_STATE_DIR ??= await mkdtemp(path.join(os.tmpdir(), "quirks-ui-standalone-env-"));
  const repositoryRoot = await createFixtureProject();
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-ui-standalone-state-"));
  await seedHistoricalCampaign(stateDir, "C-hist");

  // Import the compiled module so the standalone workspace serves the same built
  // client bundle the CLI serves (the source module resolves the bundle relative
  // to dist output).
  const { openWorkspace } = (await import(
    pathToFileURL(path.resolve("dist/src/ui/open-workspace.js")).href
  )) as OpenWorkspaceModule;
  const result = await openWorkspace({
    repositoryRoot,
    stateDir,
    deps: { json: true, isTty: false },
  });
  const viewerFragment = new URL(result.launchUrl).hash;
  return {
    authority: result.authority,
    launchUrl: result.launchUrl,
    campaignDetailUrl: `${result.authority}/campaigns/C-hist${viewerFragment}`,
    close: () => result.close?.() ?? Promise.resolve(),
  };
}

async function expectNoApprovalAffordance(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: /approve campaign/i })).toHaveCount(0);
  await expect(page.getByLabel(/reviewed the preflight proposal/i)).toHaveCount(0);
}

test("standalone workspace renders existing tasks from the fixture ledger", async ({ page }) => {
  const ui = await launchStandaloneWorkspace();
  const network = attachLoopbackNetworkGuard(page, ui.authority);

  await page.goto(ui.launchUrl);
  await expect(page.getByRole("heading", { name: "Existing tasks" })).toBeVisible();
  await expect(page.getByText("QK-1", { exact: true })).toBeVisible();
  await expect(page.getByText("Contract task")).toBeVisible();
  await expectNoApprovalAffordance(page);

  network.assertLoopbackOnly();
  await ui.close();
});

test("standalone workspace renders plan progress for a fixture task", async ({ page }) => {
  const ui = await launchStandaloneWorkspace();
  const network = attachLoopbackNetworkGuard(page, ui.authority);

  await page.goto(ui.campaignDetailUrl);
  await expect(page.getByRole("heading", { name: "Campaign C-hist" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Plan progress" })).toBeVisible();
  await expect(page.getByText("Campaign supervisor orchestration and crash recovery")).toBeVisible();
  await expect(page.getByText("Completion authority: controller")).toBeVisible();
  await expectNoApprovalAffordance(page);

  network.assertLoopbackOnly();
  await ui.close();
});
