import type { CampaignStatus } from "../../campaign/types.js";

export interface UiCampaignSummaryItem {
  campaignId: string;
  repositoryId: string;
  state: CampaignStatus;
  taskCount: number;
  startedAt?: string;
  finishedAt?: string;
  spend?: Record<string, number>;
  outcome?: string;
}

export interface UiCampaignTask {
  taskId: string;
  title: string;
  status: string;
}

export interface UiCampaignWave {
  id: string;
  label: string;
}

export interface UiCampaignRunner {
  id: string;
  kind: string;
  model: string;
}

export interface UiCampaignCommit {
  sha: string;
  message: string;
}

export interface UiCampaignPullRequest {
  number: number;
  title: string;
  url: string;
  state: "open" | "closed" | "merged" | "draft";
}

export interface UiCampaignVerification {
  label: string;
  outcome: string;
}

export interface UiCampaignDetail {
  campaignId: string;
  repositoryId: string;
  state: CampaignStatus;
  taskCount: number;
  startedAt?: string;
  finishedAt?: string;
  spend?: Record<string, number>;
  outcome?: string;
  tasks: readonly UiCampaignTask[];
  waves: readonly UiCampaignWave[];
  runners: readonly UiCampaignRunner[];
  commits: readonly UiCampaignCommit[];
  pullRequests: readonly UiCampaignPullRequest[];
  verification: readonly UiCampaignVerification[];
  sync: { pending: number; conflicts: number };
  reportPath?: string;
}

export interface CampaignReadPort {
  listSummaries(input: { repositoryId?: string }): Promise<readonly UiCampaignSummaryItem[]>;
  getDetail(campaignId: string): Promise<UiCampaignDetail>;
  getPlanProgress(input: { taskId: string; campaignId: string }): Promise<UiPlanProgressV1>;
}

export interface UiPlanProgressV1 {
  schemaVersion: 1;
  refreshedAt: string;
  campaignId: string;
  taskId: string;
  plan: {
    path: string;
    commit: string;
    taskNumber: number;
    taskTitle: string;
  };
  execution: {
    jobId: string;
    agentLabel: string;
    runnerKind: string;
    model: string;
    status: "queued" | "running" | "blocked" | "awaiting_review" | "fixing" | "verifying" | "reported_complete" | "failed" | "cancelled";
    stage: "setup" | "implement" | "commit" | "review" | "fix" | "verification";
    tddPhase: "red" | "green" | "refactor" | null;
    currentStepKey: string | null;
    note: string | null;
    workerReportedAt: string | null;
    controllerObservedAt: string;
    progressAgeSeconds: number;
  };
  steps: Array<{
    key: string;
    number: number;
    label: string;
    status: "pending" | "active" | "reported_complete" | "reviewed" | "blocked" | "failed" | "cancelled";
    reportedAt: string | null;
    reviewedAt: string | null;
  }>;
  completionAuthority: "controller";
  source: "controller-journal" | "legacy-best-effort";
}
