import assert from "node:assert/strict";
import test from "node:test";
import { createTestUiServer } from "../support/test-server.js";
import { rawLoopbackRequest } from "../support/raw-http.js";

const READ_ROUTES = [
  "/api/v1/existing-tasks",
  "/api/v1/campaigns",
  "/api/v1/campaigns/C-1",
  "/api/v1/campaigns/C-1/preflight",
  "/api/v1/tasks/QK-1/history",
  "/api/v1/tasks/QK-1/plan-progress?campaignId=C-1",
] as const;

function readHeaders(authority: { hostHeader: string; origin: string }, token?: string) {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    Host: authority.hostHeader,
    Origin: authority.origin,
    "Sec-Fetch-Site": "same-origin",
  };
}

function approvalHeaders(authority: { hostHeader: string; origin: string }, viewerToken: string) {
  return {
    Authorization: `Bearer ${viewerToken}`,
    Host: authority.hostHeader,
    "Content-Type": "application/json",
    Origin: authority.origin,
    "Sec-Fetch-Site": "same-origin",
  };
}

async function assertNoCredentialEcho(response: Response, ...secrets: string[]) {
  const body = await response.clone().text();
  for (const secret of secrets) {
    assert.ok(!body.includes(secret), "response echoed credential");
  }
  assert.equal(response.headers.get("location"), null);
}

test("GET /api/v1/approval does not mutate", async () => {
  const { authority, close } = await createTestUiServer();
  const res = await fetch(`${authority.baseUrl}/api/v1/approval?campaignId=C-1&envelopeDigest=sha256:abc`, {
    headers: { Host: authority.hostHeader, Origin: authority.origin, "Sec-Fetch-Site": "same-origin" },
    redirect: "manual",
  });
  assert.equal(res.status, 405);
  await close();
});

test("read routes fail closed without viewer authorization and never call read ports", async () => {
  const server = await createTestUiServer({
    now: "2026-07-21T12:00:00.000Z",
    campaigns: { "C-1": { repositoryId: "repo-1", envelopeDigest: "sha256:abc" } },
  });
  const { viewerToken, approvalToken } = await server.issue("C-1", "sha256:abc");
  for (const route of READ_ROUTES) {
    const before = server.readPortCalls;
    const unauthenticated = await fetch(`${server.authority.baseUrl}${route}`, {
      headers: readHeaders(server.authority),
      redirect: "manual",
    });
    assert.equal(unauthenticated.status, 401);
    assert.equal(server.readPortCalls, before);
    const unknown = await fetch(`${server.authority.baseUrl}${route}`, {
      headers: readHeaders(server.authority, "qkview_unknown-token-value-that-is-not-stored-anywhere"),
      redirect: "manual",
    });
    assert.equal(unknown.status, 401);
    assert.equal(server.readPortCalls, before);
    const approvalBearer = await fetch(`${server.authority.baseUrl}${route}`, {
      headers: readHeaders(server.authority, approvalToken),
      redirect: "manual",
    });
    assert.equal(approvalBearer.status, 401);
    assert.equal(server.readPortCalls, before);
  }
  server.setNow("2026-07-21T20:00:00.001Z");
  const idleExpired = await fetch(`${server.authority.baseUrl}/api/v1/existing-tasks`, {
    headers: readHeaders(server.authority, viewerToken),
    redirect: "manual",
  });
  assert.equal(idleExpired.status, 401);
  assert.equal(server.readPortCalls, 0);
  server.setNow("2026-07-22T12:00:00.001Z");
  const absoluteExpired = await fetch(`${server.authority.baseUrl}/api/v1/existing-tasks`, {
    headers: readHeaders(server.authority, viewerToken),
    redirect: "manual",
  });
  assert.equal(absoluteExpired.status, 401);
  assert.equal(server.readPortCalls, 0);
  await server.close();
});

test("repeated successful reads slide idle deadline but never absolute deadline", async () => {
  const server = await createTestUiServer({ now: "2026-07-21T00:00:00.000Z" });
  const { viewerToken } = await server.issue("C-1", "sha256:abc");
  server.setNow("2026-07-21T01:00:00.000Z");
  const first = await fetch(`${server.authority.baseUrl}/api/v1/existing-tasks`, {
    headers: readHeaders(server.authority, viewerToken),
    redirect: "manual",
  });
  assert.equal(first.status, 200);
  server.setNow("2026-07-21T10:00:00.001Z");
  const idleExpired = await fetch(`${server.authority.baseUrl}/api/v1/existing-tasks`, {
    headers: readHeaders(server.authority, viewerToken),
    redirect: "manual",
  });
  assert.equal(idleExpired.status, 401);
  server.setNow("2026-07-21T23:00:00.000Z");
  const cannotRevive = await fetch(`${server.authority.baseUrl}/api/v1/existing-tasks`, {
    headers: readHeaders(server.authority, viewerToken),
    redirect: "manual",
  });
  assert.equal(cannotRevive.status, 401);
  const fresh = await server.issue("C-1", "sha256:abc");
  server.setNow("2026-07-21T07:00:00.000Z");
  assert.equal(
    (await fetch(`${server.authority.baseUrl}/api/v1/existing-tasks`, {
      headers: readHeaders(server.authority, fresh.viewerToken),
      redirect: "manual",
    })).status,
    200,
  );
  server.setNow("2026-07-21T14:00:00.000Z");
  assert.equal(
    (await fetch(`${server.authority.baseUrl}/api/v1/existing-tasks`, {
      headers: readHeaders(server.authority, fresh.viewerToken),
      redirect: "manual",
    })).status,
    200,
  );
  server.setNow("2026-07-21T21:00:00.000Z");
  const capped = await fetch(`${server.authority.baseUrl}/api/v1/existing-tasks`, {
    headers: readHeaders(server.authority, fresh.viewerToken),
    redirect: "manual",
  });
  assert.equal(capped.status, 200);
  server.setNow("2026-07-22T00:00:00.001Z");
  const absoluteExpired = await fetch(`${server.authority.baseUrl}/api/v1/existing-tasks`, {
    headers: readHeaders(server.authority, viewerToken),
    redirect: "manual",
  });
  assert.equal(absoluteExpired.status, 401);
  await server.close();
});

test("approval abuse cases fail closed without redirects or credential echo", async () => {
  const server = await createTestUiServer({ now: "2026-07-21T12:00:00.000Z" });
  const { viewerToken, approvalToken } = await server.issue("C-1", "sha256:abc");
  const body = JSON.stringify({ schemaVersion: 1, campaignId: "C-1", envelopeDigest: "sha256:abc", approvalToken });
  const headers = approvalHeaders(server.authority, viewerToken);
  const first = await fetch(`${server.authority.baseUrl}/api/v1/approval`, {
    method: "POST",
    headers,
    body,
    redirect: "manual",
  });
  await assertNoCredentialEcho(first, viewerToken, approvalToken);
  assert.deepEqual(await first.json(), { schemaVersion: 1, result: "approved", approvalEventId: "approval-1" });
  const replay = await fetch(`${server.authority.baseUrl}/api/v1/approval`, {
    method: "POST",
    headers,
    body,
    redirect: "manual",
  });
  await assertNoCredentialEcho(replay, viewerToken, approvalToken);
  assert.deepEqual(await replay.json(), { schemaVersion: 1, result: "replay" });
  const staleBody = JSON.stringify({
    schemaVersion: 1,
    campaignId: "C-1",
    envelopeDigest: "sha256:def",
    approvalToken: (await server.issue("C-1", "sha256:abc")).approvalToken,
  });
  const beforeStale = server.approvePortCalls;
  const stale = await fetch(`${server.authority.baseUrl}/api/v1/approval`, {
    method: "POST",
    headers,
    body: staleBody,
    redirect: "manual",
  });
  assert.deepEqual(await stale.json(), { schemaVersion: 1, result: "stale" });
  assert.equal(server.approvePortCalls, beforeStale);
  const readAfterApproval = await fetch(`${server.authority.baseUrl}/api/v1/existing-tasks`, {
    headers: readHeaders(server.authority, viewerToken),
    redirect: "manual",
  });
  assert.equal(readAfterApproval.status, 200);
  await server.close();
});

test("rejects hostile host, origin, fetch metadata, interchange, and oversize bodies", async () => {
  const server = await createTestUiServer();
  const { viewerToken, approvalToken } = await server.issue("C-1", "sha256:abc");
  const wrongHost = await rawLoopbackRequest({
    port: server.authority.port,
    path: "/api/v1/existing-tasks",
    headers: {
      ...readHeaders(server.authority, viewerToken),
      Host: "127.0.0.1:wrong",
    },
  });
  assert.equal(wrongHost.status, 403);
  const nullOrigin = await fetch(`${server.authority.baseUrl}/api/v1/approval`, {
    method: "POST",
    headers: { ...approvalHeaders(server.authority, viewerToken), Origin: "null" },
    body: JSON.stringify({ schemaVersion: 1, campaignId: "C-1", envelopeDigest: "sha256:abc", approvalToken }),
    redirect: "manual",
  });
  assert.equal(nullOrigin.status, 403);
  const missingFetchSite = await fetch(`${server.authority.baseUrl}/api/v1/approval`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${viewerToken}`,
      Host: server.authority.hostHeader,
      "Content-Type": "application/json",
      Origin: server.authority.origin,
    },
    body: JSON.stringify({ schemaVersion: 1, campaignId: "C-1", envelopeDigest: "sha256:abc", approvalToken }),
    redirect: "manual",
  });
  assert.equal(missingFetchSite.status, 403);
  const interchange = await fetch(`${server.authority.baseUrl}/api/v1/approval`, {
    method: "POST",
    headers: approvalHeaders(server.authority, approvalToken),
    body: JSON.stringify({ schemaVersion: 1, campaignId: "C-1", envelopeDigest: "sha256:abc", approvalToken }),
    redirect: "manual",
  });
  assert.equal(interchange.status, 401);
  const equalCredentials = await fetch(`${server.authority.baseUrl}/api/v1/approval`, {
    method: "POST",
    headers: approvalHeaders(server.authority, viewerToken),
    body: JSON.stringify({
      schemaVersion: 1,
      campaignId: "C-1",
      envelopeDigest: "sha256:abc",
      approvalToken: viewerToken,
    }),
    redirect: "manual",
  });
  assert.deepEqual(await equalCredentials.json(), { schemaVersion: 1, result: "invalid" });
  const wrongRepository = await createTestUiServer({
    campaigns: { "C-1": { repositoryId: "repo-other", envelopeDigest: "sha256:abc" } },
  });
  const wrongRepoTokens = await wrongRepository.issue("C-1", "sha256:abc");
  const repoMismatch = await fetch(`${wrongRepository.authority.baseUrl}/api/v1/approval`, {
    method: "POST",
    headers: approvalHeaders(wrongRepository.authority, wrongRepoTokens.viewerToken),
    body: JSON.stringify({
      schemaVersion: 1,
      campaignId: "C-1",
      envelopeDigest: "sha256:abc",
      approvalToken: wrongRepoTokens.approvalToken,
    }),
    redirect: "manual",
  });
  assert.equal(repoMismatch.status, 403);
  await wrongRepository.close();
  const formPost = await fetch(`${server.authority.baseUrl}/api/v1/approval`, {
    method: "POST",
    headers: {
      ...approvalHeaders(server.authority, viewerToken),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "campaignId=C-1",
    redirect: "manual",
  });
  assert.equal(formPost.status, 415);
  const oversized = "x".repeat(1_048_577);
  const tooLarge = await fetch(`${server.authority.baseUrl}/api/v1/approval`, {
    method: "POST",
    headers: approvalHeaders(server.authority, viewerToken),
    body: JSON.stringify({
      schemaVersion: 1,
      campaignId: "C-1",
      envelopeDigest: "sha256:abc",
      approvalToken,
      padding: oversized,
    }),
    redirect: "manual",
  });
  assert.equal(tooLarge.status, 413);
  await server.close();
});

test("expires approval tokens independently of viewer sessions", async () => {
  const server = await createTestUiServer({ now: "2026-07-21T12:00:00.000Z" });
  const { viewerToken, approvalToken } = await server.issue("C-1", "sha256:abc");
  server.setNow("2026-07-21T12:15:00.001Z");
  const expiredApproval = await fetch(`${server.authority.baseUrl}/api/v1/approval`, {
    method: "POST",
    headers: approvalHeaders(server.authority, viewerToken),
    body: JSON.stringify({ schemaVersion: 1, campaignId: "C-1", envelopeDigest: "sha256:abc", approvalToken }),
    redirect: "manual",
  });
  assert.deepEqual(await expiredApproval.json(), { schemaVersion: 1, result: "expired" });
  const stillReadable = await fetch(`${server.authority.baseUrl}/api/v1/existing-tasks`, {
    headers: readHeaders(server.authority, viewerToken),
    redirect: "manual",
  });
  assert.equal(stillReadable.status, 200);
  await server.close();
});
