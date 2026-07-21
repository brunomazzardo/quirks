import type { CampaignEnvelope } from "../../src/campaign/types.js";

export function campaignEnvelope(overrides: Partial<CampaignEnvelope> = {}): CampaignEnvelope {
  return {
    schemaVersion: 1,
    campaignId: "cmp-20260721-abc123",
    digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    repositoryId: "sha256:repo",
    createdAt: "2026-07-21T16:00:00.000Z",
    taskIds: ["QK-101"], taskRevisions: { "QK-101": "sha256:rev" }, designModes: {},
    git: { baseCommit: "a".repeat(40), campaignBranch: "quirks/cmp-20260721-abc123", targetBranch: "main", push: { enabled: false } },
    authority: ["repository"], routing: {},
    budgets: { maxTasks: 1, maxConcurrency: 1, maxWallClockMs: 3_600_000, maxRetries: 1, laneFailureThreshold: 2 },
    verification: ["pnpm test"], hashes: { config: "sha256:cfg", workflowPolicy: "sha256:wf", instructions: "sha256:ins" }, externalRoutingEnabled: false,
    ...overrides,
  };
}
