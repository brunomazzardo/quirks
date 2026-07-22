export const campaignStatuses = [
  "draft", "preflight", "awaiting_approval", "running", "paused", "blocked",
  "final_review", "landing", "hold", "complete", "cancelled",
] as const;

export type CampaignStatus = typeof campaignStatuses[number];
export type JudgmentTier = "mechanical" | "standard" | "high" | "principal";

export interface CampaignEnvelope {
  schemaVersion: 1;
  campaignId: string;
  digest: string;
  repositoryId: string;
  createdAt: string;
  taskIds: string[];
  taskRevisions: Record<string, string>;
  designModes: Record<string, { mode: "human" | "human-after-draft" | "delegated"; envelope: string[] }>;
  git: { baseCommit: string; campaignBranch: string; targetBranch: string; push: { enabled: boolean; remote?: string; branch?: string } };
  authority: ("repository" | "task-source" | "runner" | "operator" | "git")[];
  routing: Record<string, { primary: CampaignRoute; fallbacks: CampaignRoute[] }>;
  budgets: { maxTasks: number; maxConcurrency: number; maxWallClockMs: number; maxRetries: number; laneFailureThreshold: number };
  verification: string[];
  hashes: { config: string; workflowPolicy: string; instructions: string };
  externalRoutingEnabled: boolean;
}

export interface CampaignRoute { profileId: string; tier: JudgmentTier; effort: JudgmentTier }

export interface CampaignSnapshot {
  schemaVersion: 1;
  campaignId: string;
  status: CampaignStatus;
  digest: string;
  updatedAt: string;
  pausedReason?: string;
  blockedReason?: string;
  activeLanes?: string[];
  spend?: Record<string, number>;
}

export interface CampaignEvent {
  schemaVersion: 1;
  id: string;
  type: string;
  at: string;
  actor: string;
  from: CampaignStatus;
  to: CampaignStatus;
  reason: string;
  evidence: Record<string, string>;
}

export interface CampaignApproval {
  schemaVersion: 1;
  campaignId: string;
  digest: string;
  approvedAt: string;
  operator: { kind: "configured-profile" | "authenticated-host" | "authenticated-provider" | "self-asserted"; id: string };
  tokenId: string;
  evidence: Record<string, string>;
}

export interface ProgressBinding {
  schemaVersion: 1;
  repositoryId: string;
  campaignId: string;
  taskId: string;
  jobId: string;
  attempt: number;
  planPath: string;
  planCommit: string;
  allowedPlanTasks: readonly number[];
}

export interface StoredProgressEvent {
  schemaVersion: 1;
  jobId: string;
  revision: number;
  observedAt: string;
  event: Record<string, unknown>;
}
