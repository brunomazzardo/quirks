import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { test, expect, type Page } from "@playwright/test";
import { attachLoopbackNetworkGuard } from "./support/launch-ui.js";

const execFileAsync = promisify(execFile);

type OpenWorkspaceModule = typeof import("../../src/ui/open-workspace.js");
type ProjectConfigModule = typeof import("../../src/project/config.js");
type CampaignStoreModule = typeof import("../../src/campaign/store.js");
type CampaignEnvelopeModule = typeof import("../../src/campaign/envelope.js");
type CampaignStoreInstance = Awaited<
  ReturnType<CampaignStoreModule["CampaignStore"]["create"]>
>;

async function importCompiled<T>(relativePath: string): Promise<T> {
  return (await import(pathToFileURL(path.resolve(relativePath)).href)) as T;
}

async function createFixtureProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-ui-approval-project-"));
  await cp(path.resolve("test/fixtures/json-project"), root, { recursive: true });
  await execFileAsync("git", ["init", root]);
  return root;
}

// Seeds a REAL durable awaiting_approval campaign through CampaignStore.create,
// exactly as the campaign CLI persists one: schema-valid envelope with a
// recomputable digest, state.json at awaiting_approval, empty approvals.jsonl.
async function seedDurableCampaign(
  stateDir: string,
  repositoryId: string,
  campaignId: string,
): Promise<{ store: CampaignStoreInstance; digest: string }> {
  const { finalizeEnvelope } = await importCompiled<CampaignEnvelopeModule>("dist/src/campaign/envelope.js");
  const { CampaignStore } = await importCompiled<CampaignStoreModule>("dist/src/campaign/store.js");
  const envelope = finalizeEnvelope({
    schemaVersion: 1,
    campaignId,
    repositoryId,
    createdAt: "2026-07-23T09:00:00.000Z",
    taskIds: ["QK-1"],
    taskRevisions: { "QK-1": "sha256:rev-1" },
    designModes: { "QK-1": { mode: "human", envelope: [] } },
    git: {
      baseCommit: "a".repeat(40),
      campaignBranch: `quirks/${campaignId}/integration`,
      targetBranch: "main",
      push: { enabled: false },
    },
    authority: ["repository", "task-source", "operator", "git"],
    routing: {
      "QK-1": {
        primary: { profileId: "fixture-implementer", tier: "standard", effort: "standard" },
        fallbacks: [{ profileId: "fixture-reviewer", tier: "high", effort: "standard" }],
      },
    },
    budgets: { maxTasks: 2, maxConcurrency: 1, maxWallClockMs: 3_600_000, maxRetries: 1, laneFailureThreshold: 2 },
    verification: ["pnpm test"],
    hashes: {
      config: `sha256:${"b".repeat(64)}`,
      workflowPolicy: `sha256:${"c".repeat(64)}`,
      instructions: `sha256:${"d".repeat(64)}`,
    },
    externalRoutingEnabled: false,
  });
  const store = await CampaignStore.create({ stateDir, repositoryId, campaignId, envelope });
  return { store, digest: envelope.digest };
}

type CampaignFixture = {
  authority: string;
  launchUrl: string;
  digest: string;
  store: CampaignStoreInstance;
  stateDir: string;
  repositoryRoot: string;
  repositoryId: string;
  close: () => Promise<void>;
};

async function launchCampaignBoundWorkspace(campaignId: string): Promise<CampaignFixture> {
  process.env.QUIRKS_STATE_DIR ??= await mkdtemp(path.join(os.tmpdir(), "quirks-ui-approval-env-"));
  const repositoryRoot = await createFixtureProject();
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-ui-approval-state-"));

  const { loadProjectContext } = await importCompiled<ProjectConfigModule>("dist/src/project/config.js");
  const { openWorkspace } = await importCompiled<OpenWorkspaceModule>("dist/src/ui/open-workspace.js");
  const context = await loadProjectContext(repositoryRoot, { mode: "inspection" });
  const { store, digest } = await seedDurableCampaign(stateDir, context.repositoryId, campaignId);

  // The exact production path that shipped broken on 2026-07-23: campaign-bound
  // openWorkspace with production ports.
  const result = await openWorkspace({
    campaignId,
    repositoryRoot,
    stateDir,
    ports: "production",
    deps: { json: true, isTty: false },
  });
  return {
    authority: result.authority,
    launchUrl: result.launchUrl,
    digest,
    store,
    stateDir,
    repositoryRoot,
    repositoryId: context.repositoryId,
    close: () => result.close?.() ?? Promise.resolve(),
  };
}

async function expectNoApprovalAffordance(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: /approve campaign/i })).toHaveCount(0);
  await expect(page.getByLabel(/reviewed the preflight proposal/i)).toHaveCount(0);
}

test("campaign-bound production workspace renders and submits the approval form", async ({ page }) => {
  const ui = await launchCampaignBoundWorkspace("C-real");
  const network = attachLoopbackNetworkGuard(page, ui.authority);

  await page.goto(ui.launchUrl);
  // First paint waits on the durable read port (campaign store + task ledger)
  // behind a real server boot; allow extra headroom on loaded machines.
  await expect(page.getByRole("heading", { name: "Preflight proposal" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Campaign", { exact: false }).first()).toBeVisible();

  // Durable envelope facts render.
  await expect(page.getByText("quirks/C-real/integration")).toBeVisible();
  await expect(page.getByText("QK-1", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Contract task").first()).toBeVisible();
  await expect(page.getByText("Human design approval required for task QK-1")).toBeVisible();

  // Fields the envelope does not persist are shown honestly unavailable.
  await expect(page.getByText("Confidence unavailable").first()).toBeVisible();
  await expect(page.getByText("Wave assignments are not recorded in the durable campaign envelope.")).toBeVisible();
  await expect(page.getByText("Agent lane details are not recorded in the durable campaign envelope.")).toBeVisible();

  // The approval form is VISIBLE and interactable — the exact gap that shipped.
  const acknowledgement = page.getByLabel(/reviewed the preflight proposal/i);
  await expect(acknowledgement).toBeVisible();
  const approveButton = page.getByRole("button", { name: /approve campaign/i });
  await expect(approveButton).toBeVisible();
  await expect(approveButton).toBeDisabled();
  await acknowledgement.check();
  await expect(approveButton).toBeEnabled();
  await approveButton.click();
  await expect(page.getByRole("status").filter({ hasText: /campaign approved/i })).toBeVisible();

  // The approval is durable evidence, not a client-side projection.
  const approvalsRaw = await readFile(ui.store.approvalsFile, "utf8");
  const approvals = approvalsRaw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { campaignId: string; digest: string });
  expect(approvals).toHaveLength(1);
  expect(approvals[0]).toMatchObject({ campaignId: "C-real", digest: ui.digest });

  network.assertLoopbackOnly();
  await ui.close();
});

test("standalone workspace renders the durable proposal with approval suppressed", async ({ page }) => {
  const ui = await launchCampaignBoundWorkspace("C-ro");
  await ui.close();

  // Re-open the SAME durable state standalone (read-only, no campaign binding).
  const { openWorkspace } = await importCompiled<OpenWorkspaceModule>("dist/src/ui/open-workspace.js");
  const readOnly = await openWorkspace({
    repositoryRoot: ui.repositoryRoot,
    stateDir: ui.stateDir,
    deps: { json: true, isTty: false },
  });
  const network = attachLoopbackNetworkGuard(page, readOnly.authority);
  try {
    const viewerFragment = new URL(readOnly.launchUrl).hash;
    expect(viewerFragment).not.toContain("approvalToken");
    await page.goto(`${readOnly.authority}/preflight/C-ro${viewerFragment}`);

    // Same headroom as the campaign-bound first paint: the durable read port
    // does real store and ledger work behind this assertion.
    await expect(page.getByRole("heading", { name: "Preflight proposal" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Contract task").first()).toBeVisible();
    await expect(page.getByText("Confidence unavailable").first()).toBeVisible();

    await expectNoApprovalAffordance(page);
    await expect(
      page.getByText("This workspace is read-only and holds no approval credential.", { exact: false }),
    ).toBeVisible();

    network.assertLoopbackOnly();
  } finally {
    await readOnly.close?.();
  }
});
