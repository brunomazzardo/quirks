/**
 * "unavailable" and `null` are honest markers for proposal fields the durable
 * campaign envelope does not persist (scheduling projections such as waves,
 * lanes, estimates, and confidence). They are never substitutes for stored
 * data; producers must emit real values whenever a durable record exists.
 */
export type UiPreflightConfidence = "low" | "medium" | "high" | "unavailable";

export type UiPreflightProposalV1 = {
  schemaVersion: 1;
  campaignId: string;
  state: "awaiting_approval";
  envelopeDigest: string;
  summary: {
    taskCount: number;
    waveCount: number | null;
    estimatedMinutes: number | null;
    confidence: UiPreflightConfidence;
    budget: { maxWallClockMs: number; maxConcurrency: number };
    landing: { baseCommit: string; campaignBranch: string; targetBranch: string };
    push: { enabled: boolean; remote: string | null; branch: string | null };
  };
  waves: Array<{ id: string; label: string; taskIds: string[] }>;
  lanes: Array<{ id: string; label: string; runner: string; model: string; taskIds: string[] }>;
  tasks: Array<{
    taskId: string;
    title: string;
    waveId: string | null;
    laneId: string | null;
    route: { profileId: string; tier: "mechanical" | "standard" | "high" | "principal"; effort: "mechanical" | "standard" | "high" | "principal" };
    fallback: { profileId: string; tier: "mechanical" | "standard" | "high" | "principal"; effort: "mechanical" | "standard" | "high" | "principal" } | null;
    confidence: UiPreflightConfidence;
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
