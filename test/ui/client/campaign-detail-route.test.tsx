import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import type { ApiClient } from "../../../src/ui/client/api-client.js";
import { createAppRouter } from "../../../src/ui/client/router.js";
import { campaignDetailQueryOptions } from "../../../src/ui/client/query-options.js";
import { RUNNING_CAMPAIGN_DETAIL } from "../support/fake-campaigns.js";

/** Never settles: static render must not depend on background fetches. */
function pendingForever<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

function fakeApiClient(): ApiClient {
  return {
    getExistingTasks: pendingForever,
    getPreflight: pendingForever,
    getCampaigns: pendingForever,
    getCampaignDetail: pendingForever,
    getTaskHistory: pendingForever,
    getPlanProgress: pendingForever,
    getPrompts: pendingForever,
    submitApproval: pendingForever,
  };
}

async function renderCampaignDetailRoute(campaignId: string, payload: unknown): Promise<string> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const apiClient = fakeApiClient();
  queryClient.setQueryData(
    campaignDetailQueryOptions(apiClient, campaignId).queryKey,
    payload as never,
  );
  const router = createAppRouter({
    context: { queryClient, apiClient },
    history: createMemoryHistory({ initialEntries: [`/campaigns/${campaignId}`] }),
  });
  await router.load();
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

test("a detail payload without campaign fields renders an explicit unavailable state, not a crash", async () => {
  // Exact shape the workspace router used to fabricate for a read route whose
  // port was missing: a 200 body with no tasks/waves/sync at all. A RUNNING
  // campaign-bound workspace served this and the view crashed on tasks[0].
  const fabricatedFallback = {
    schemaVersion: 1,
    route: "/api/v1/campaigns/cmp-085d9450814a",
    refreshedAt: "2026-07-23T20:04:13.715Z",
  };
  const html = await renderCampaignDetailRoute("cmp-085d9450814a", fabricatedFallback);
  assert.match(html, /Campaign detail is unavailable for this workspace\./);
  assert.doesNotMatch(html, /Something went wrong/);
});

test("a RUNNING campaign detail renders live-truth fields with explicit empty sections", async () => {
  const html = await renderCampaignDetailRoute("C-running", RUNNING_CAMPAIGN_DETAIL);
  assert.match(html, /Campaign C-running/);
  assert.match(html, /Running/);
  // Claimed tasks from the durable ledger render as-is.
  assert.match(html, /QK-1/);
  assert.match(html, /claimed/);
  // Not-yet-recorded sections are explicit, never invented.
  assert.match(html, /No waves\./);
  assert.match(html, /No commits\./);
  assert.match(html, /No pull requests\./);
  assert.match(html, /No verification results\./);
  assert.match(html, /No runners\./);
  // No recorded outcome renders as pending, and timing shows in-progress truth.
  assert.match(html, /Pending/);
  assert.match(html, /In progress/);
});
