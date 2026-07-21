import type { UiExistingTasksV1 } from "../read-models/existing-tasks.js";
import type { UiCampaignDetail, UiCampaignSummaryItem, UiPlanProgressV1 } from "../ports/campaign-read.js";
import type { UiTaskHistoryV1 } from "../read-models/task-history.js";
import type { UiPreflightProposalV1 } from "../types/preflight-proposal.js";
import { createApprovalFetcher, createReadFetcher } from "./fetch-json.js";
import type { TokenVault } from "./token-vault.js";

export type UiCampaignSummaryV1 = {
  schemaVersion: 1;
  items: readonly UiCampaignSummaryItem[];
};

export type UiCampaignDetailV1 = UiCampaignDetail & {
  schemaVersion: 1;
  canRunAgain: true;
};

export type UiApprovalResponseV1 = {
  schemaVersion: 1;
  result: "approved" | "rejected" | "stale" | "expired" | "replay" | "invalid";
  approvalEventId?: string;
};

export interface ApiClient {
  getExistingTasks(): Promise<UiExistingTasksV1>;
  getPreflight(campaignId: string): Promise<UiPreflightProposalV1>;
  getCampaigns(input?: { repositoryId?: string }): Promise<UiCampaignSummaryV1>;
  getCampaignDetail(campaignId: string): Promise<UiCampaignDetailV1>;
  getTaskHistory(taskId: string): Promise<UiTaskHistoryV1>;
  getPlanProgress(taskId: string, campaignId: string): Promise<UiPlanProgressV1>;
  submitApproval(input: { campaignId: string; envelopeDigest: string }): Promise<UiApprovalResponseV1>;
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export function createApiClient(vault: TokenVault): ApiClient {
  const fetchRead = createReadFetcher(vault);
  const fetchApproval = createApprovalFetcher(vault);

  return {
    async getExistingTasks() {
      return readJson(await fetchRead("/api/v1/existing-tasks"));
    },
    async getPreflight(campaignId) {
      return readJson(await fetchRead(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/preflight`));
    },
    async getCampaigns(input) {
      const path =
        input?.repositoryId === undefined
          ? "/api/v1/campaigns"
          : `/api/v1/campaigns?repositoryId=${encodeURIComponent(input.repositoryId)}`;
      return readJson(await fetchRead(path));
    },
    async getCampaignDetail(campaignId) {
      return readJson(await fetchRead(`/api/v1/campaigns/${encodeURIComponent(campaignId)}`));
    },
    async getTaskHistory(taskId) {
      return readJson(await fetchRead(`/api/v1/tasks/${encodeURIComponent(taskId)}/history`));
    },
    async getPlanProgress(taskId, campaignId) {
      const params = new URLSearchParams({ campaignId });
      return readJson(await fetchRead(`/api/v1/tasks/${encodeURIComponent(taskId)}/plan-progress?${params.toString()}`));
    },
    async submitApproval(input) {
      return readJson(
        await fetchApproval("/api/v1/approval", {
          schemaVersion: 1,
          campaignId: input.campaignId,
          envelopeDigest: input.envelopeDigest,
        }),
      );
    },
  };
}
