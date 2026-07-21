import { queryOptions } from "@tanstack/react-query";
import type { ApiClient } from "./api-client.js";

export const queryKeys = {
  existingTasks: () => ["ui", "existing-tasks"] as const,
  preflight: (campaignId: string) => ["ui", "preflight", campaignId] as const,
  campaigns: (repositoryId?: string) =>
    repositoryId === undefined
      ? (["ui", "campaigns"] as const)
      : (["ui", "campaigns", repositoryId] as const),
  campaignDetail: (campaignId: string) => ["ui", "campaign-detail", campaignId] as const,
  taskHistory: (taskId: string) => ["ui", "task-history", taskId] as const,
};

export function existingTasksQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: queryKeys.existingTasks(),
    queryFn: () => api.getExistingTasks(),
  });
}

export function preflightQueryOptions(api: ApiClient, campaignId: string) {
  return queryOptions({
    queryKey: queryKeys.preflight(campaignId),
    queryFn: () => api.getPreflight(campaignId),
  });
}

export function campaignsQueryOptions(api: ApiClient, input?: { repositoryId?: string }) {
  return queryOptions({
    queryKey: queryKeys.campaigns(input?.repositoryId),
    queryFn: () => api.getCampaigns(input),
  });
}

export function campaignDetailQueryOptions(api: ApiClient, campaignId: string) {
  return queryOptions({
    queryKey: queryKeys.campaignDetail(campaignId),
    queryFn: () => api.getCampaignDetail(campaignId),
  });
}

export function taskHistoryQueryOptions(api: ApiClient, taskId: string) {
  return queryOptions({
    queryKey: queryKeys.taskHistory(taskId),
    queryFn: () => api.getTaskHistory(taskId),
  });
}
