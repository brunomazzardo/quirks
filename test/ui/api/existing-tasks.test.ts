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

test("GET /api/v1/existing-tasks returns validated projection", async () => {
  const server = await createTestUiServer();
  const { viewerToken } = await server.issue("C-1", "sha256:abc");
  const response = await fetch(`${server.authority.baseUrl}/api/v1/existing-tasks`, {
    headers: readHeaders(server.authority, viewerToken),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.coordinationNotice, "Local coordination only");
  assert.equal(body.leaseNotice, "No shared lease");
  assert.ok(Array.isArray(body.tasks));
  await server.close();
});
