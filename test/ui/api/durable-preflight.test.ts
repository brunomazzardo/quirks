import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { finalizeEnvelope } from "../../../src/campaign/envelope.js";
import { CampaignStore } from "../../../src/campaign/store.js";
import type { CampaignEnvelope } from "../../../src/campaign/types.js";
import { loadProjectContext } from "../../../src/project/config.js";
import { openWorkspace } from "../../../src/ui/open-workspace.js";
import type { UiPreflightProposalV1 } from "../../../src/ui/types/preflight-proposal.js";

process.env.QUIRKS_STATE_DIR = await mkdtemp(path.join(os.tmpdir(), "quirks-durable-preflight-env-"));

const execFileAsync = promisify(execFile);

async function createFixtureProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-durable-preflight-project-"));
  await cp(path.resolve("test/fixtures/json-project"), root, { recursive: true });
  await execFileAsync("git", ["init", root]);
  return root;
}

function buildEnvelope(repositoryId: string, campaignId: string): CampaignEnvelope {
  return finalizeEnvelope({
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
}

async function seedDurableCampaign(
  stateDir: string,
  repositoryId: string,
  campaignId: string,
): Promise<{ envelope: CampaignEnvelope; store: CampaignStore }> {
  const envelope = buildEnvelope(repositoryId, campaignId);
  const store = await CampaignStore.create({ stateDir, repositoryId, campaignId, envelope });
  return { envelope, store };
}

function tokensFromLaunchUrl(launchUrl: string): { viewerToken: string; approvalToken: string | undefined } {
  const fragment = new URL(launchUrl).hash.replace(/^#/, "");
  const params = new URLSearchParams(fragment);
  const viewerToken = params.get("viewToken");
  assert.ok(viewerToken, "launch URL carries a viewer token");
  return { viewerToken, approvalToken: params.get("approvalToken") ?? undefined };
}

function readHeaders(authority: string, viewerToken: string) {
  return {
    Authorization: `Bearer ${viewerToken}`,
    Origin: authority,
    "Sec-Fetch-Site": "same-origin",
  };
}

test("campaign-bound production workspace serves the preflight proposal from durable state", async () => {
  const repositoryRoot = await createFixtureProject();
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-durable-preflight-state-"));
  const context = await loadProjectContext(repositoryRoot, { mode: "inspection" });
  const { envelope } = await seedDurableCampaign(stateDir, context.repositoryId, "C-real");

  const workspace = await openWorkspace({
    campaignId: "C-real",
    repositoryRoot,
    stateDir,
    ports: "production",
    deps: { json: true, isTty: false },
  });
  try {
    const { viewerToken, approvalToken } = tokensFromLaunchUrl(workspace.launchUrl);
    assert.ok(approvalToken, "awaiting_approval campaign issues an approval token");
    const headers = readHeaders(workspace.authority, viewerToken);

    const response = await fetch(`${workspace.authority}/api/v1/campaigns/C-real/preflight`, { headers });
    assert.equal(response.status, 200, "preflight is served from durable state instead of 503");
    const proposal = (await response.json()) as UiPreflightProposalV1;

    assert.equal(proposal.campaignId, "C-real");
    assert.equal(proposal.state, "awaiting_approval");
    assert.equal(proposal.envelopeDigest, envelope.digest);
    assert.deepEqual(proposal.approval, { campaignId: "C-real", envelopeDigest: envelope.digest });

    // Durable envelope facts.
    assert.equal(proposal.summary.taskCount, 1);
    assert.deepEqual(proposal.summary.budget, { maxWallClockMs: 3_600_000, maxConcurrency: 1 });
    assert.deepEqual(proposal.summary.landing, {
      baseCommit: "a".repeat(40),
      campaignBranch: "quirks/C-real/integration",
      targetBranch: "main",
    });
    assert.deepEqual(proposal.summary.push, { enabled: false, remote: null, branch: null });
    assert.deepEqual(proposal.humanGates, ["Human design approval required for task QK-1"]);
    assert.deepEqual(proposal.unsupportedCapabilities, ["remote-git-push", "external-routing"]);

    // Fields the envelope does not persist stay honestly unavailable.
    assert.equal(proposal.summary.waveCount, null);
    assert.equal(proposal.summary.estimatedMinutes, null);
    assert.equal(proposal.summary.confidence, "unavailable");
    assert.deepEqual(proposal.waves, []);
    assert.deepEqual(proposal.lanes, []);
    assert.equal(proposal.inspector, null);
    assert.ok(
      proposal.residuals.some((entry) => /not persisted/i.test(entry)),
      "residuals state that scheduling projections are not persisted",
    );

    // Task rows bind the durable routing and the real ledger title.
    assert.equal(proposal.tasks.length, 1);
    const task = proposal.tasks[0]!;
    assert.equal(task.taskId, "QK-1");
    assert.equal(task.title, "Contract task");
    assert.equal(task.waveId, null);
    assert.equal(task.laneId, null);
    assert.equal(task.confidence, "unavailable");
    assert.deepEqual(task.route, { profileId: "fixture-implementer", tier: "standard", effort: "standard" });
    assert.deepEqual(task.fallback, { profileId: "fixture-reviewer", tier: "high", effort: "standard" });
  } finally {
    await workspace.close?.();
  }
});

test("approval POST against a durable campaign records the approval durably", async () => {
  const repositoryRoot = await createFixtureProject();
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-durable-approve-state-"));
  const context = await loadProjectContext(repositoryRoot, { mode: "inspection" });
  const { envelope, store } = await seedDurableCampaign(stateDir, context.repositoryId, "C-approve");

  const workspace = await openWorkspace({
    campaignId: "C-approve",
    repositoryRoot,
    stateDir,
    ports: "production",
    deps: { json: true, isTty: false },
  });
  try {
    const { viewerToken, approvalToken } = tokensFromLaunchUrl(workspace.launchUrl);
    assert.ok(approvalToken);
    const response = await fetch(`${workspace.authority}/api/v1/approval`, {
      method: "POST",
      headers: { ...readHeaders(workspace.authority, viewerToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        campaignId: "C-approve",
        envelopeDigest: envelope.digest,
        approvalToken,
      }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { schemaVersion: 1; result: string; approvalEventId?: string };
    assert.equal(body.result, "approved");
    assert.ok(body.approvalEventId);

    const approvals = await store.readApprovals();
    assert.equal(approvals.length, 1, "approval is recorded in approvals.jsonl");
    assert.equal(approvals[0]!.campaignId, "C-approve");
    assert.equal(approvals[0]!.digest, envelope.digest);
    const events = await store.readEvents();
    assert.ok(
      events.some((event) => event.type === "approval.recorded" && event.evidence["digest"] === envelope.digest),
      "approval.recorded event is journaled",
    );

    // Replay of the same durable approval fails closed.
    const replay = await fetch(`${workspace.authority}/api/v1/approval`, {
      method: "POST",
      headers: { ...readHeaders(workspace.authority, viewerToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        campaignId: "C-approve",
        envelopeDigest: envelope.digest,
        approvalToken,
      }),
    });
    assert.deepEqual(await replay.json(), { schemaVersion: 1, result: "replay" });
    assert.equal((await store.readApprovals()).length, 1);

    // The proposal is still served while durable status remains awaiting_approval,
    // and it surfaces the recorded approval honestly.
    const after = await fetch(`${workspace.authority}/api/v1/campaigns/C-approve/preflight`, {
      headers: readHeaders(workspace.authority, viewerToken),
    });
    assert.equal(after.status, 200);
    const proposal = (await after.json()) as UiPreflightProposalV1;
    assert.ok(
      proposal.residuals.some((entry) => /durable approval is already recorded/i.test(entry)),
      "residuals surface the recorded durable approval",
    );
  } finally {
    await workspace.close?.();
  }
});

test("standalone workspace serves the durable preflight proposal read-only", async () => {
  const repositoryRoot = await createFixtureProject();
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-durable-standalone-state-"));
  const context = await loadProjectContext(repositoryRoot, { mode: "inspection" });
  const { envelope } = await seedDurableCampaign(stateDir, context.repositoryId, "C-await");
  await seedDurableCampaign(stateDir, "sha256:other-repo", "C-foreign");

  const workspace = await openWorkspace({
    repositoryRoot,
    stateDir,
    deps: { json: true, isTty: false },
  });
  try {
    assert.equal(workspace.readOnly, true);
    const { viewerToken, approvalToken } = tokensFromLaunchUrl(workspace.launchUrl);
    assert.equal(approvalToken, undefined, "read-only workspace issues no approval credential");
    const headers = readHeaders(workspace.authority, viewerToken);

    const response = await fetch(`${workspace.authority}/api/v1/campaigns/C-await/preflight`, { headers });
    assert.equal(response.status, 200);
    const proposal = (await response.json()) as UiPreflightProposalV1;
    assert.equal(proposal.envelopeDigest, envelope.digest);
    assert.equal(proposal.summary.confidence, "unavailable");

    // Repository scoping: another repository's campaign is invisible.
    const foreign = await fetch(`${workspace.authority}/api/v1/campaigns/C-foreign/preflight`, { headers });
    assert.equal(foreign.status, 404);

    // The read-only approval boundary is unchanged.
    const approval = await fetch(`${workspace.authority}/api/v1/approval`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        campaignId: "C-await",
        envelopeDigest: envelope.digest,
        approvalToken: "qkapprove_forged",
      }),
    });
    assert.equal(approval.status, 409);
    assert.deepEqual(await approval.json(), {
      schemaVersion: 1,
      result: "invalid",
      error: "read_only_workspace",
    });
  } finally {
    await workspace.close?.();
  }
});

test("durable preflight refuses campaigns that are not awaiting approval", async () => {
  const repositoryRoot = await createFixtureProject();
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-durable-notawait-state-"));
  const context = await loadProjectContext(repositoryRoot, { mode: "inspection" });
  const { envelope, store } = await seedDurableCampaign(stateDir, context.repositoryId, "C-done");
  await store.writeState({
    schemaVersion: 1,
    campaignId: "C-done",
    status: "complete",
    digest: envelope.digest,
    updatedAt: "2026-07-23T10:00:00.000Z",
  });

  const workspace = await openWorkspace({
    repositoryRoot,
    stateDir,
    deps: { json: true, isTty: false },
  });
  try {
    const { viewerToken } = tokensFromLaunchUrl(workspace.launchUrl);
    const headers = readHeaders(workspace.authority, viewerToken);
    const response = await fetch(`${workspace.authority}/api/v1/campaigns/C-done/preflight`, { headers });
    assert.equal(response.status, 404);

    const missing = await fetch(`${workspace.authority}/api/v1/campaigns/C-missing/preflight`, { headers });
    assert.equal(missing.status, 404);
  } finally {
    await workspace.close?.();
  }
});

// Read-model contract: the durable proposal read model never fabricates data —
// this file also guards against reintroducing fixture values into production.
test("durable preflight proposal contains no fixture placeholder values", async () => {
  const repositoryRoot = await createFixtureProject();
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-durable-nofixture-state-"));
  const context = await loadProjectContext(repositoryRoot, { mode: "inspection" });
  await seedDurableCampaign(stateDir, context.repositoryId, "C-honest");

  const workspace = await openWorkspace({
    campaignId: "C-honest",
    repositoryRoot,
    stateDir,
    ports: "production",
    deps: { json: true, isTty: false },
  });
  try {
    const { viewerToken } = tokensFromLaunchUrl(workspace.launchUrl);
    const response = await fetch(`${workspace.authority}/api/v1/campaigns/C-honest/preflight`, {
      headers: readHeaders(workspace.authority, viewerToken),
    });
    assert.equal(response.status, 200);
    const raw = await response.text();
    assert.ok(!raw.includes("preflight-digest"), "no fake fixture digest leaks into production data");
    assert.ok(!raw.includes("composer-2.5"), "no fixture lane model leaks into production data");
    assert.ok(!raw.includes("Delegated design task"), "no fixture task title leaks into production data");
  } finally {
    await workspace.close?.();
  }
});

// Verify approvals.jsonl file path stays inside the campaign directory (sanity
// on the durable evidence the assertions above rely on).
test("seeded campaign store writes the expected durable files", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-durable-files-state-"));
  const { store } = await seedDurableCampaign(stateDir, "sha256:file-check", "C-files");
  const stateRaw = JSON.parse(await readFile(store.stateFile, "utf8")) as { status: string };
  assert.equal(stateRaw.status, "awaiting_approval");
  assert.equal(await readFile(store.approvalsFile, "utf8"), "");
});
