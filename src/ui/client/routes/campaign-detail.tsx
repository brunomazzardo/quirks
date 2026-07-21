import { useQuery } from "@tanstack/react-query";
import { useParams, useRouteContext } from "@tanstack/react-router";
import type { ApiClient } from "../api-client.js";
import { campaignDetailQueryOptions } from "../query-options.js";
import type { RouterContext } from "../router.js";
import { CampaignDetailView } from "../views/campaign-detail-view.js";

function CampaignDetailContent({ apiClient, campaignId }: { apiClient: ApiClient; campaignId: string }) {
  const query = useQuery(campaignDetailQueryOptions(apiClient, campaignId));

  if (query.isPending) return <p role="status">Loading campaign…</p>;
  if (query.isError) return <p role="alert">Unable to load campaign.</p>;

  return <CampaignDetailView detail={query.data} />;
}

export function CampaignDetailRoute() {
  const { campaignId } = useParams({ strict: false }) as { campaignId?: string };
  const { apiClient } = useRouteContext({ strict: false }) as RouterContext;

  if (!campaignId) return <p role="alert">Unknown campaign.</p>;

  return <CampaignDetailContent apiClient={apiClient as ApiClient} campaignId={campaignId} />;
}
