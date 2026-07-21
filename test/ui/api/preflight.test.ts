import assert from "node:assert/strict";
import test from "node:test";
import { createTestUiServer } from "../support/test-server.js";

function readHeaders(authority: { hostHeader: string; origin: string }, token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Host: authority.hostHeader,
    Origin: authority.origin,
    "Sec-Fetch-Site": "same-origin",
  };
}

test("GET /api/v1/campaigns/:id/preflight returns proposal for awaiting approval", async () => {
  const server = await createTestUiServer();
  const { viewerToken } = await server.issue("C-1", "sha256:abc");
  const response = await fetch(`${server.authority.baseUrl}/api/v1/campaigns/C-1/preflight`, {
    headers: readHeaders(server.authority, viewerToken),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.campaignId, "C-1");
  assert.equal(body.approval.envelopeDigest, body.envelopeDigest);
  await server.close();
});

test("GET /api/v1/campaigns/:id/preflight returns 404 when not awaiting approval", async () => {
  const server = await createTestUiServer({
    campaigns: { "C-2": { repositoryId: "repo-1", envelopeDigest: "sha256:abc", status: "running" } },
  });
  const { viewerToken } = await server.issue("C-2", "sha256:abc");
  const response = await fetch(`${server.authority.baseUrl}/api/v1/campaigns/C-2/preflight`, {
    headers: readHeaders(server.authority, viewerToken),
  });
  assert.equal(response.status, 404);
  await server.close();
});
