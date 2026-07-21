import assert from "node:assert/strict";
import test from "node:test";
import { validateSchema } from "../../src/schema/validate.js";

const existingTasks = {
  schemaVersion: 1,
  refreshedAt: "2026-07-21T12:00:00.000Z",
  source: { driver: "json", protocol: "task-source-v1", syncHealth: "fresh", pendingWrites: 0, conflicts: 0 },
  coordinationNotice: "Local coordination only",
  leaseNotice: "No shared lease",
  tasks: [{
    id: "QK-1",
    title: "Example",
    kind: "implementation",
    priority: "P1",
    status: "ready",
    readiness: "ready",
    blockers: [],
    workflowPhase: "execute",
    designGate: { required: false, mode: "human", delegable: false },
    risk: [],
    effort: "standard",
    suggestedRoute: { tier: "standard", label: "Composer 2.5" },
    source: { driver: "json", nativeId: "QK-1", webUrl: null },
    nativeRevision: "sha256:abc",
    dependsOn: [],
    coordination: null,
  }],
};

const preflightProposal = {
  schemaVersion: 1,
  campaignId: "cmp-1",
  state: "awaiting_approval",
  envelopeDigest: "sha256:digest",
  summary: {
    taskCount: 1,
    waveCount: 1,
    estimatedMinutes: 30,
    confidence: "high",
    budget: { maxWallClockMs: 3600000, maxConcurrency: 2 },
    landing: { baseCommit: "a".repeat(40), campaignBranch: "campaign/cmp-1", targetBranch: "main" },
    push: { enabled: false, remote: null, branch: null },
  },
  waves: [{ id: "w1", label: "Wave 1", taskIds: ["QK-1"] }],
  lanes: [{ id: "l1", label: "Lane 1", runner: "cursor", model: "composer-2.5", taskIds: ["QK-1"] }],
  tasks: [{
    taskId: "QK-1",
    title: "Example",
    waveId: "w1",
    laneId: "l1",
    route: { profileId: "cursor", tier: "standard", effort: "standard" },
    fallback: null,
    confidence: "high",
  }],
  inspector: null,
  residuals: ["none"],
  humanGates: [],
  unsupportedCapabilities: [],
  approval: { campaignId: "cmp-1", envelopeDigest: "sha256:digest" },
};

const campaignSummary = {
  schemaVersion: 1,
  items: [{
    campaignId: "cmp-1",
    repositoryId: "sha256:repo",
    state: "running",
    taskCount: 1,
    startedAt: "2026-07-21T12:00:00.000Z",
  }],
};

const campaignDetail = {
  schemaVersion: 1,
  campaignId: "cmp-1",
  repositoryId: "sha256:repo",
  state: "running",
  taskCount: 1,
  tasks: [{ taskId: "QK-1", title: "Example", status: "running" }],
  waves: [{ id: "w1", label: "Wave 1" }],
  runners: [{ id: "r1", kind: "cursor", model: "composer-2.5" }],
  commits: [{ sha: "a".repeat(40), message: "feat: example" }],
  pullRequests: [{ number: 1, title: "Example PR", url: "https://github.com/org/repo/pull/1", state: "open" }],
  verification: [{ label: "pnpm test", outcome: "passed" }],
  sync: { pending: 0, conflicts: 0 },
  canRunAgain: true,
};

const taskHistory = {
  schemaVersion: 1,
  taskId: "QK-1",
  iterations: [{
    id: "it-1",
    outcome: "completed",
    artifactRefs: [{
      path: "docs/spec.md",
      commit: "a".repeat(40),
      sha: "a".repeat(40),
      url: "https://github.com/org/repo/blob/abc/docs/spec.md",
      availability: "available",
      actions: ["open-as-executed", "open-current", "compare"],
      identities: [{ label: "agent", evidence: "authenticated-host", verified: true }],
    }],
  }],
};

const approvalRequest = {
  schemaVersion: 1,
  campaignId: "cmp-1",
  envelopeDigest: "sha256:digest",
  approvalToken: "qkapprove_" + "a".repeat(43),
};

const approvalResponse = {
  schemaVersion: 1,
  result: "approved",
  approvalEventId: "evt-1",
};

const schemaCases = [
  ["ui-existing-tasks-v1", existingTasks],
  ["ui-preflight-proposal-v1", preflightProposal],
  ["ui-campaign-summary-v1", campaignSummary],
  ["ui-campaign-detail-v1", campaignDetail],
  ["ui-task-history-v1", taskHistory],
  ["ui-approval-request-v1", approvalRequest],
  ["ui-approval-response-v1", approvalResponse],
] as const;

test("accepts ui-existing-tasks-v1 and rejects unknown fields", () => {
  assert.deepEqual(validateSchema("ui-existing-tasks-v1", existingTasks), existingTasks);
  assert.throws(
    () => validateSchema("ui-existing-tasks-v1", { ...existingTasks, surprise: true }),
    /must NOT have additional properties/,
  );
});

for (const [name, payload] of schemaCases) {
  test(`accepts ${name} and rejects unknown fields`, () => {
    assert.deepEqual(validateSchema(name, payload), payload);
    assert.throws(
      () => validateSchema(name, { ...payload, surprise: true }),
      /must NOT have additional properties/,
    );
  });
}
