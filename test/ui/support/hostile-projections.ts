import type { UiCampaignDetail } from "../../../src/ui/ports/campaign-read.js";
import type { UiExistingTasksV1 } from "../../../src/ui/read-models/existing-tasks.js";
import type { UiArtifactAction, UiTaskHistoryV1 } from "../../../src/ui/read-models/task-history.js";
import type { UiPreflightProposalV1 } from "../../../src/ui/types/preflight-proposal.js";

export const hostileText = {
  script: "\u202e<script>alert(1)</script>\u202d",
  image: '"><img src=x onerror=alert(1)>',
  handler: "onerror=alert(1)",
  bidi: "safe\u202efile\u202c",
};

export const hostileUrlVariants = [
  "javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "//evil.example/steal",
  "https://user:pass@example.com/private",
  "http://evil.example/internal",
  "http://[::1",
] as const;

const artifactActions = (): UiArtifactAction[] => ["open-as-executed", "open-current", "compare"];

export function hostileExistingTasksProjection(): UiExistingTasksV1 {
  return {
    schemaVersion: 1,
    refreshedAt: "2026-07-21T00:00:00.000Z",
    source: {
      driver: "json",
      protocol: "task-source-v1",
      syncHealth: "fresh",
      pendingWrites: 0,
      conflicts: 0,
    },
    coordinationNotice: "Local coordination only",
    leaseNotice: "No shared lease",
    tasks: hostileUrlVariants.map((webUrl, index) => ({
      id: `HOSTILE-${index + 1}`,
      title: `${hostileText.script} ${hostileText.bidi}`,
      kind: "implementation",
      priority: "P1",
      status: "blocked",
      readiness: "blocked",
      blockers: [`Blocked on ${hostileText.image}`],
      workflowPhase: "execute",
      designGate: { required: false, mode: "human", delegable: false },
      risk: [hostileText.handler],
      effort: "standard",
      suggestedRoute: { tier: "standard", label: hostileText.image },
      source: { driver: "json", nativeId: hostileText.image, webUrl },
      nativeRevision: hostileText.script,
      dependsOn: [],
      coordination: {
        scope: "local-clone",
        campaignId: hostileText.script,
        owner: hostileText.image,
      },
    })),
  };
}

export function hostilePreflightProposal(): UiPreflightProposalV1 {
  return {
    schemaVersion: 1,
    campaignId: hostileText.script,
    state: "awaiting_approval",
    envelopeDigest: "sha256:hostile",
    summary: {
      taskCount: 1,
      waveCount: 1,
      estimatedMinutes: 15,
      confidence: "low",
      budget: { maxWallClockMs: 900_000, maxConcurrency: 1 },
      landing: {
        baseCommit: hostileText.script,
        campaignBranch: hostileText.image,
        targetBranch: hostileText.bidi,
      },
      push: { enabled: true, remote: hostileText.image, branch: hostileText.script },
    },
    waves: [{ id: "wave-1", label: hostileText.image, taskIds: ["HOSTILE-1"] }],
    lanes: [
      {
        id: "lane-1",
        label: hostileText.script,
        runner: hostileText.image,
        model: hostileText.bidi,
        taskIds: ["HOSTILE-1"],
      },
    ],
    tasks: [
      {
        taskId: "HOSTILE-1",
        title: hostileText.script,
        waveId: "wave-1",
        laneId: "lane-1",
        route: { profileId: hostileText.image, tier: "standard", effort: "standard" },
        fallback: { profileId: hostileText.script, tier: "high", effort: "high" },
        confidence: "low",
      },
    ],
    inspector: {
      taskId: "HOSTILE-1",
      routingRationale: hostileText.image,
      tests: [hostileText.script],
      acceptanceProof: hostileText.image,
    },
    residuals: [hostileText.script],
    humanGates: [hostileText.image],
    unsupportedCapabilities: [hostileText.bidi],
    approval: { campaignId: hostileText.script, envelopeDigest: "sha256:hostile" },
  };
}

export function hostileCampaignDetail(): UiCampaignDetail {
  return {
    campaignId: hostileText.script,
    repositoryId: hostileText.image,
    state: "running",
    taskCount: 1,
    outcome: hostileText.bidi,
    tasks: [{ taskId: "HOSTILE-1", title: hostileText.script, status: hostileText.image }],
    waves: [{ id: "wave-1", label: hostileText.image }],
    runners: [{ id: hostileText.script, kind: hostileText.image, model: hostileText.bidi }],
    commits: [{ sha: hostileText.script, message: hostileText.image }],
    pullRequests: hostileUrlVariants.map((url, index) => ({
      number: index + 1,
      title: hostileText.script,
      url,
      state: "open",
    })),
    verification: [{ label: hostileText.image, outcome: hostileText.script }],
    sync: { pending: 0, conflicts: 0 },
    reportPath: hostileText.image,
  };
}

export function hostileTaskHistoryProjection(): UiTaskHistoryV1 {
  return {
    schemaVersion: 1,
    taskId: hostileText.script,
    iterations: [
      {
        id: hostileText.image,
        outcome: hostileText.script,
        artifactRefs: [
          ...hostileUrlVariants.map((url, index) => ({
            path: `${hostileText.image}-${index}`,
            commit: hostileText.script,
            sha: hostileText.script,
            url,
            availability: "available" as const,
            actions: artifactActions(),
            identities: [
              { label: hostileText.image, evidence: "self-asserted" as const, verified: false },
            ],
          })),
          {
            path: "src/ui/client/views/task-history-view.tsx",
            commit: "207c92e",
            sha: "207c92e",
            url: "https://example.com/provider/path",
            availability: "available",
            actions: artifactActions(),
            identities: [{ label: "Signed Author", evidence: "git-signature", verified: true }],
          },
        ],
      },
    ],
  };
}
