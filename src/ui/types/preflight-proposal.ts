export type UiPreflightProposalV1 = {
  schemaVersion: 1;
  campaignId: string;
  state: "awaiting_approval";
  envelopeDigest: string;
  summary: {
    taskCount: number;
    waveCount: number;
    estimatedMinutes: number;
    confidence: "low" | "medium" | "high";
    budget: { maxWallClockMs: number; maxConcurrency: number };
    landing: { baseCommit: string; campaignBranch: string; targetBranch: string };
    push: { enabled: boolean; remote: string | null; branch: string | null };
  };
  waves: Array<{ id: string; label: string; taskIds: string[] }>;
  lanes: Array<{ id: string; label: string; runner: string; model: string; taskIds: string[] }>;
  tasks: Array<{
    taskId: string;
    title: string;
    waveId: string;
    laneId: string;
    route: { profileId: string; tier: "mechanical" | "standard" | "high" | "principal"; effort: "mechanical" | "standard" | "high" | "principal" };
    fallback: { profileId: string; tier: "mechanical" | "standard" | "high" | "principal"; effort: "mechanical" | "standard" | "high" | "principal" } | null;
    confidence: "low" | "medium" | "high";
  }>;
  inspector: {
    taskId: string;
    routingRationale: string;
    tests: string[];
    acceptanceProof: string;
  } | null;
  residuals: string[];
  humanGates: string[];
  unsupportedCapabilities: string[];
  approval: { campaignId: string; envelopeDigest: string };
};
