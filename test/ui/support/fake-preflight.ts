import type { UiPreflightProposalV1 } from "../../../src/ui/types/preflight-proposal.js";
import type { PreflightReadPort } from "../../../src/ui/ports/preflight-read.js";

const BASE_COMMIT = "a".repeat(40);

function proposalFor(campaignId: string): UiPreflightProposalV1 {
  return {
    schemaVersion: 1,
    campaignId,
    state: "awaiting_approval",
    envelopeDigest: "sha256:preflight-digest",
    summary: {
      taskCount: 1,
      waveCount: 1,
      estimatedMinutes: 45,
      confidence: "medium",
      budget: { maxWallClockMs: 3_600_000, maxConcurrency: 2 },
      landing: {
        baseCommit: BASE_COMMIT,
        campaignBranch: `campaign/${campaignId}`,
        targetBranch: "main",
      },
      push: { enabled: false, remote: null, branch: null },
    },
    waves: [{ id: "wave-1", label: "Wave 1", taskIds: ["QK-1"] }],
    lanes: [{ id: "lane-1", label: "Lane 1", runner: "cursor", model: "composer-2.5", taskIds: ["QK-1"] }],
    tasks: [{
      taskId: "QK-1",
      title: "Delegated design task",
      waveId: "wave-1",
      laneId: "lane-1",
      route: { profileId: "cursor", tier: "standard", effort: "standard" },
      fallback: { profileId: "cursor-reviewer", tier: "high", effort: "standard" },
      confidence: "high",
    }],
    inspector: {
      taskId: "QK-1",
      routingRationale: "Delegated design envelope: approve campaign shape before execution.",
      tests: ["pnpm test"],
      acceptanceProof: "Design envelope accepted in preflight review.",
    },
    residuals: ["Pending provider acknowledgement for task sync"],
    humanGates: ["Design approval before execution"],
    unsupportedCapabilities: ["remote-git-push"],
    approval: { campaignId, envelopeDigest: "sha256:preflight-digest" },
  };
}

export function fakePreflightPort(proposals: Record<string, UiPreflightProposalV1> = {}): PreflightReadPort {
  return {
    getProposal: async (campaignId) => proposals[campaignId] ?? proposalFor(campaignId),
  };
}
