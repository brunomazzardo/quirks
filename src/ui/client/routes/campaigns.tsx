import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import type { ApiClient } from "../api-client.js";
import { campaignsQueryOptions } from "../query-options.js";
import type { RouterContext } from "../router.js";
import { CampaignsView } from "../views/campaigns-view.js";

export function CampaignsRoute() {
  const { apiClient } = useRouteContext({ strict: false }) as RouterContext;
  const query = useQuery(campaignsQueryOptions(apiClient as ApiClient));

  if (query.isPending) return <p role="status">Loading campaigns…</p>;
  if (query.isError) return <p role="alert">Unable to load campaigns.</p>;

  return <CampaignsView items={query.data.items} />;
}
