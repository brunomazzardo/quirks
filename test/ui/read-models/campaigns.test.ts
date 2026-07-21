import assert from "node:assert/strict";
import test from "node:test";
import { buildCampaignDetail, buildCampaignList } from "../../../src/ui/read-models/campaigns.js";
import { fakeCampaignReadPort } from "../support/fake-campaigns.js";

test("lists local journals with default repository filter", async () => {
  const items = await buildCampaignList(fakeCampaignReadPort(), {});
  assert.ok(items.length >= 1);
  assert.ok(items.every((item) => item.state.length > 0));
});

test("filters campaign list by repositoryId", async () => {
  const items = await buildCampaignList(fakeCampaignReadPort(), { repositoryId: "sha256:other-repo" });
  assert.deepEqual(items, []);
});

test("rejects a campaign summary that fails schema validation", async () => {
  const port = fakeCampaignReadPort({
    summaries: [{ campaignId: "C-9", repositoryId: "not-a-digest", state: "running", taskCount: 1 }],
  });
  await assert.rejects(() => buildCampaignList(port, {}));
});

test("returns append-only campaign detail with canRunAgain true regardless of state", async () => {
  const detail = await buildCampaignDetail(fakeCampaignReadPort(), "C-1");
  assert.equal(detail.campaignId, "C-1");
  assert.equal(detail.canRunAgain, true);
  assert.ok(detail.tasks.length > 0);
  assert.ok(detail.pullRequests.length > 0);
});

test("throws when a campaign is not found", async () => {
  await assert.rejects(() => buildCampaignDetail(fakeCampaignReadPort(), "missing"));
});
