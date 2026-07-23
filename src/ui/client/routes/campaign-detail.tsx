import { useQuery } from "@tanstack/react-query";
import { useParams, useRouteContext } from "@tanstack/react-router";
import type { UiCampaignDetail } from "../../ports/campaign-read.js";
import type { ApiClient } from "../api-client.js";
import { campaignDetailQueryOptions, planProgressQueryOptions, promptQueryOptions } from "../query-options.js";
import type { RouterContext } from "../router.js";
import { CampaignDetailView } from "../views/campaign-detail-view.js";

/**
 * Structural guard for the campaign-detail projection. The server may answer a
 * detail request with a non-detail body (for example when the workspace has no
 * campaign read port); rendering that would either crash on index access or
 * invent empty campaign data. Absent detail renders an explicit unavailable
 * state instead.
 */
export function isRenderableCampaignDetail(payload: unknown): payload is UiCampaignDetail {
  if (typeof payload !== "object" || payload === null) return false;
  const detail = payload as Record<string, unknown>;
  return (
    typeof detail["campaignId"] === "string" &&
    typeof detail["state"] === "string" &&
    Array.isArray(detail["tasks"]) &&
    Array.isArray(detail["waves"]) &&
    Array.isArray(detail["runners"]) &&
    Array.isArray(detail["commits"]) &&
    Array.isArray(detail["pullRequests"]) &&
    Array.isArray(detail["verification"]) &&
    typeof detail["sync"] === "object" &&
    detail["sync"] !== null
  );
}

function CampaignDetailContent({ apiClient, campaignId }: { apiClient: ApiClient; campaignId: string }) {
  const query = useQuery(campaignDetailQueryOptions(apiClient, campaignId));
  // A payload without a tasks array (e.g. a RUNNING campaign served by a
  // workspace with no campaign read port) must not crash on index access.
  const selectedTaskId = query.data?.tasks?.[0]?.taskId;
  const progressQuery = useQuery({
    ...planProgressQueryOptions(apiClient, selectedTaskId ?? "", campaignId),
    enabled: Boolean(selectedTaskId),
  });
  const promptQuery = useQuery({
    ...promptQueryOptions(apiClient, { contextKind: "campaign", campaignId }),
    retry: false,
  });

  if (query.isPending) return <p role="status">Loading campaign…</p>;
  if (query.isError) return <p role="alert">Unable to load campaign.</p>;
  if (!isRenderableCampaignDetail(query.data)) {
    return <p role="alert">Campaign detail is unavailable for this workspace.</p>;
  }

  return (
    <CampaignDetailView
      detail={query.data}
      {...(progressQuery.data ? { planProgress: progressQuery.data } : {})}
      planProgressPending={progressQuery.isPending}
      planProgressUnavailable={progressQuery.isError}
      {...(promptQuery.data ? { promptSet: promptQuery.data } : {})}
    />
  );
}

export function CampaignDetailRoute() {
  const { campaignId } = useParams({ strict: false }) as { campaignId?: string };
  const { apiClient } = useRouteContext({ strict: false }) as RouterContext;

  if (!campaignId) return <p role="alert">Unknown campaign.</p>;

  return <CampaignDetailContent apiClient={apiClient as ApiClient} campaignId={campaignId} />;
}
