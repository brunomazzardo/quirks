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
}
