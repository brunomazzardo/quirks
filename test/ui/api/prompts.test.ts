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

test("returns applicable prompts only to an authorized viewer", async () => {
  const server = await createTestUiServer();
  const { viewerToken } = await server.issue("C-1", "sha256:abc");

  const unauthorized = await fetch(`${server.authority.baseUrl}/api/v1/prompts?contextKind=review&taskId=QK-1`, {
    headers: {
      Host: server.authority.hostHeader,
      Origin: server.authority.origin,
      "Sec-Fetch-Site": "same-origin",
    },
  });
  assert.equal(unauthorized.status, 401);

  const response = await fetch(`${server.authority.baseUrl}/api/v1/prompts?contextKind=review&taskId=QK-1`, {
    headers: readHeaders(server.authority, viewerToken),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.recommendedRecipeId, "review-task-code");
  assert.equal(JSON.stringify(body).includes("approvalToken"), false);
  assert.ok(Array.isArray(body.recipes) && body.recipes.length >= 1);
  await server.close();
});

test("rejects malformed and unsupported prompt queries with 400", async () => {
  const server = await createTestUiServer();
  const { viewerToken } = await server.issue("C-1", "sha256:abc");
  const headers = readHeaders(server.authority, viewerToken);
  const base = `${server.authority.baseUrl}/api/v1/prompts`;

  assert.equal((await fetch(`${base}`, { headers })).status, 400);
  assert.equal((await fetch(`${base}?contextKind=bogus&taskId=QK-1`, { headers })).status, 400);
  assert.equal((await fetch(`${base}?contextKind=review`, { headers })).status, 400);
  assert.equal((await fetch(`${base}?contextKind=campaign`, { headers })).status, 400);
  assert.equal(
    (await fetch(`${base}?contextKind=review&taskId=QK-1&surprise=1`, { headers })).status,
    400,
  );
  await server.close();
});

test("missing prompt context is not fabricated", async () => {
  const server = await createTestUiServer();
  const { viewerToken } = await server.issue("C-1", "sha256:abc");
  const response = await fetch(
    `${server.authority.baseUrl}/api/v1/prompts?contextKind=review&taskId=UNKNOWN`,
    { headers: readHeaders(server.authority, viewerToken) },
  );
  assert.equal(response.status, 404);
  await server.close();
});

test("campaign context returns the start recipe only when approval is recorded", async () => {
  const server = await createTestUiServer();
  const { viewerToken } = await server.issue("C-approved", "sha256:abc");
  const response = await fetch(
    `${server.authority.baseUrl}/api/v1/prompts?contextKind=campaign&campaignId=C-approved`,
    { headers: readHeaders(server.authority, viewerToken) },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.recommendedRecipeId, "start-approved-campaign");
  await server.close();
});

test("prompt route rejects non-GET methods", async () => {
  const server = await createTestUiServer();
  const { viewerToken } = await server.issue("C-1", "sha256:abc");
  const response = await fetch(`${server.authority.baseUrl}/api/v1/prompts?contextKind=review&taskId=QK-1`, {
    method: "POST",
    headers: readHeaders(server.authority, viewerToken),
  });
  assert.equal(response.status, 405);
  await server.close();
});
