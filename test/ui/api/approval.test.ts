import assert from "node:assert/strict";
import test from "node:test";
import { createTestUiServer } from "../support/test-server.js";

test("rejects cross-origin and form POST approval", async () => {
  const { authority, close, issue } = await createTestUiServer();
  const { viewerToken, approvalToken } = await issue("C-1", "sha256:abc");
  const xhr = await fetch(`${authority.baseUrl}/api/v1/approval`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${viewerToken}`,
      "Content-Type": "application/json",
      Origin: "http://evil.test",
      Host: authority.hostHeader,
      "Sec-Fetch-Site": "cross-site",
    },
    body: JSON.stringify({ schemaVersion: 1, campaignId: "C-1", envelopeDigest: "sha256:abc", approvalToken }),
  });
  assert.equal(xhr.status, 403);
  const form = await fetch(`${authority.baseUrl}/api/v1/approval`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${viewerToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: authority.origin,
      Host: authority.hostHeader,
      "Sec-Fetch-Site": "same-origin",
    },
    body: "campaignId=C-1",
  });
  assert.equal(form.status, 415);
  await close();
});

test("approves with viewer-authenticated JSON POST and rejects replay", async () => {
  const server = await createTestUiServer();
  const { viewerToken, approvalToken } = await server.issue("C-1", "sha256:abc");
  const body = JSON.stringify({ schemaVersion: 1, campaignId: "C-1", envelopeDigest: "sha256:abc", approvalToken });
  const headers = {
    Authorization: `Bearer ${viewerToken}`,
    Host: server.authority.hostHeader,
    "Content-Type": "application/json",
    Origin: server.authority.origin,
    "Sec-Fetch-Site": "same-origin",
  };
  const first = await fetch(`${server.authority.baseUrl}/api/v1/approval`, { method: "POST", headers, body });
  assert.deepEqual(await first.json(), { schemaVersion: 1, result: "approved", approvalEventId: "approval-1" });
  const replay = await fetch(`${server.authority.baseUrl}/api/v1/approval`, { method: "POST", headers, body });
  assert.deepEqual(await replay.json(), { schemaVersion: 1, result: "replay" });
  await server.close();
});

test("returns stale for digest mismatch without approval port mutation", async () => {
  const server = await createTestUiServer();
  const { viewerToken, approvalToken } = await server.issue("C-1", "sha256:abc");
  const response = await fetch(`${server.authority.baseUrl}/api/v1/approval`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${viewerToken}`,
      Host: server.authority.hostHeader,
      "Content-Type": "application/json",
      Origin: server.authority.origin,
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify({
      schemaVersion: 1,
      campaignId: "C-1",
      envelopeDigest: "sha256:def",
      approvalToken,
    }),
  });
  assert.deepEqual(await response.json(), { schemaVersion: 1, result: "stale" });
  assert.equal(server.approvePortCalls, 0);
  await server.close();
});

test("rejects missing Sec-Fetch-Site and GET mutation attempts", async () => {
  const server = await createTestUiServer();
  const { viewerToken, approvalToken } = await server.issue("C-1", "sha256:abc");
  const missingFetchSite = await fetch(`${server.authority.baseUrl}/api/v1/approval`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${viewerToken}`,
      Host: server.authority.hostHeader,
      "Content-Type": "application/json",
      Origin: server.authority.origin,
    },
    body: JSON.stringify({ schemaVersion: 1, campaignId: "C-1", envelopeDigest: "sha256:abc", approvalToken }),
  });
  assert.equal(missingFetchSite.status, 403);
  const get = await fetch(`${server.authority.baseUrl}/api/v1/approval`, {
    headers: { Host: server.authority.hostHeader },
  });
  assert.equal(get.status, 405);
  await server.close();
});

test("authorizes viewer reads and rejects approval bearer interchange", async () => {
  const server = await createTestUiServer();
  const { viewerToken, approvalToken } = await server.issue("C-1", "sha256:abc");
  const read = await fetch(`${server.authority.baseUrl}/api/v1/existing-tasks`, {
    headers: {
      Authorization: `Bearer ${viewerToken}`,
      Host: server.authority.hostHeader,
      Origin: server.authority.origin,
      "Sec-Fetch-Site": "same-origin",
    },
  });
  assert.equal(read.status, 200);
  assert.equal(server.readPortCalls, 1);
  const approvalBearer = await fetch(`${server.authority.baseUrl}/api/v1/existing-tasks`, {
    headers: {
      Authorization: `Bearer ${approvalToken}`,
      Host: server.authority.hostHeader,
      Origin: server.authority.origin,
      "Sec-Fetch-Site": "same-origin",
    },
  });
  assert.equal(approvalBearer.status, 401);
  assert.equal(server.readPortCalls, 1);
  await server.close();
});

test("rejects repository mismatch and equal bearer/body credentials", async () => {
  const server = await createTestUiServer({
    campaigns: { "C-1": { repositoryId: "repo-other", envelopeDigest: "sha256:abc" } },
  });
  const { viewerToken, approvalToken } = await server.issue("C-1", "sha256:abc");
  const mismatch = await fetch(`${server.authority.baseUrl}/api/v1/approval`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${viewerToken}`,
      Host: server.authority.hostHeader,
      "Content-Type": "application/json",
      Origin: server.authority.origin,
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify({ schemaVersion: 1, campaignId: "C-1", envelopeDigest: "sha256:abc", approvalToken }),
  });
  assert.equal(mismatch.status, 403);
  const equal = await fetch(`${server.authority.baseUrl}/api/v1/approval`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${viewerToken}`,
      Host: server.authority.hostHeader,
      "Content-Type": "application/json",
      Origin: server.authority.origin,
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify({
      schemaVersion: 1,
      campaignId: "C-1",
      envelopeDigest: "sha256:abc",
      approvalToken: viewerToken,
    }),
  });
  assert.equal(equal.status, 200);
  assert.deepEqual(await equal.json(), { schemaVersion: 1, result: "invalid" });
  await server.close();
});

test("expires viewer and approval credentials independently", async () => {
  const server = await createTestUiServer({ now: "2026-07-21T12:00:00.000Z" });
  const { viewerToken, approvalToken } = await server.issue("C-1", "sha256:abc");
  server.setNow("2026-07-21T12:15:00.001Z");
  const expiredApproval = await fetch(`${server.authority.baseUrl}/api/v1/approval`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${viewerToken}`,
      Host: server.authority.hostHeader,
      "Content-Type": "application/json",
      Origin: server.authority.origin,
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify({ schemaVersion: 1, campaignId: "C-1", envelopeDigest: "sha256:abc", approvalToken }),
  });
  assert.deepEqual(await expiredApproval.json(), { schemaVersion: 1, result: "expired" });
  server.setNow("2026-07-22T12:00:00.001Z");
  const expiredViewer = await fetch(`${server.authority.baseUrl}/api/v1/existing-tasks`, {
    headers: {
      Authorization: `Bearer ${viewerToken}`,
      Host: server.authority.hostHeader,
      Origin: server.authority.origin,
      "Sec-Fetch-Site": "same-origin",
    },
  });
  assert.equal(expiredViewer.status, 401);
  await server.close();
});
