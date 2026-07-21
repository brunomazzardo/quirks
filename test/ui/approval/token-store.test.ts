import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryViewerSessionStore } from "../../../src/ui/auth/viewer-session-store.js";
import { InMemoryApprovalTokenStore } from "../../../src/ui/approval/token-store.js";

test("caps sliding viewer idle expiry at its absolute lifetime", async () => {
  const store = new InMemoryViewerSessionStore();
  const issued = await store.issue({ repositoryId: "repo-1", now: "2026-07-21T00:00:00.000Z" });
  const first = await store.authorize({
    viewerToken: issued.viewerToken,
    repositoryId: "repo-1",
    now: "2026-07-21T07:00:00.000Z",
  });
  assert.equal(first.result, "authorized");
  if (first.result === "authorized") assert.equal(first.idleExpiresAt, "2026-07-21T15:00:00.000Z");
  const second = await store.authorize({
    viewerToken: issued.viewerToken,
    repositoryId: "repo-1",
    now: "2026-07-21T14:00:00.000Z",
  });
  assert.equal(second.result, "authorized");
  if (second.result === "authorized") assert.equal(second.idleExpiresAt, "2026-07-21T22:00:00.000Z");
  const capped = await store.authorize({
    viewerToken: issued.viewerToken,
    repositoryId: "repo-1",
    now: "2026-07-21T21:00:00.000Z",
  });
  assert.equal(capped.result, "authorized");
  if (capped.result === "authorized") assert.equal(capped.idleExpiresAt, issued.absoluteExpiresAt);
});

test("does not revive idle-expired viewer session near absolute lifetime", async () => {
  const store = new InMemoryViewerSessionStore();
  const issued = await store.issue({ repositoryId: "repo-1", now: "2026-07-21T00:00:00.000Z" });
  const revived = await store.authorize({
    viewerToken: issued.viewerToken,
    repositoryId: "repo-1",
    now: "2026-07-21T23:00:00.000Z",
  });
  assert.equal(revived.result, "expired");
});

test("consumes approval token once and rejects replay", async () => {
  const store = new InMemoryApprovalTokenStore();
  const issued = await store.issue({ campaignId: "C-1", envelopeDigest: "sha256:abc", now: "2026-07-21T12:00:00.000Z" });
  const first = await store.consume({
    campaignId: "C-1",
    envelopeDigest: "sha256:abc",
    approvalToken: issued.approvalToken,
    now: "2026-07-21T12:00:30.000Z",
  });
  assert.equal(first, "ok");
  const second = await store.consume({
    campaignId: "C-1",
    envelopeDigest: "sha256:abc",
    approvalToken: issued.approvalToken,
    now: "2026-07-21T12:00:31.000Z",
  });
  assert.equal(second, "replay");
});

test("extends viewer idle expiry on touch but never absolute expiry", async () => {
  const store = new InMemoryViewerSessionStore();
  const issued = await store.issue({ repositoryId: "repo-1", now: "2026-07-21T00:00:00.000Z" });
  const first = await store.authorize({
    viewerToken: issued.viewerToken,
    repositoryId: "repo-1",
    now: "2026-07-21T01:00:00.000Z",
  });
  assert.equal(first.result, "authorized");
  if (first.result === "authorized") {
    assert.equal(first.absoluteExpiresAt, issued.absoluteExpiresAt);
    assert.equal(first.idleExpiresAt, "2026-07-21T09:00:00.000Z");
  }
  const second = await store.authorize({
    viewerToken: issued.viewerToken,
    repositoryId: "repo-1",
    now: "2026-07-21T02:00:00.000Z",
  });
  assert.equal(second.result, "authorized");
  if (second.result === "authorized") {
    assert.equal(second.absoluteExpiresAt, issued.absoluteExpiresAt);
    assert.equal(second.idleExpiresAt, "2026-07-21T10:00:00.000Z");
  }
});

test("rejects viewer session at idle and absolute boundaries", async () => {
  const store = new InMemoryViewerSessionStore();
  const issued = await store.issue({ repositoryId: "repo-1", now: "2026-07-21T00:00:00.000Z" });
  const idleExpired = await store.authorize({
    viewerToken: issued.viewerToken,
    repositoryId: "repo-1",
    now: "2026-07-21T08:00:00.001Z",
  });
  assert.equal(idleExpired.result, "expired");
  const absoluteExpired = await store.authorize({
    viewerToken: issued.viewerToken,
    repositoryId: "repo-1",
    now: "2026-07-22T00:00:00.001Z",
  });
  assert.equal(absoluteExpired.result, "expired");
});

test("cannot revive an expired viewer session", async () => {
  const store = new InMemoryViewerSessionStore();
  const issued = await store.issue({ repositoryId: "repo-1", now: "2026-07-21T00:00:00.000Z" });
  assert.equal(
    (await store.authorize({ viewerToken: issued.viewerToken, repositoryId: "repo-1", now: "2026-07-22T00:00:00.001Z" })).result,
    "expired",
  );
  assert.equal(
    (await store.authorize({ viewerToken: issued.viewerToken, repositoryId: "repo-1", now: "2026-07-22T01:00:00.000Z" })).result,
    "expired",
  );
});

test("binds viewer sessions to repository identity", async () => {
  const store = new InMemoryViewerSessionStore();
  const issued = await store.issue({ repositoryId: "repo-1", now: "2026-07-21T00:00:00.000Z" });
  assert.equal(
    (await store.authorize({ viewerToken: issued.viewerToken, repositoryId: "repo-2", now: "2026-07-21T01:00:00.000Z" })).result,
    "invalid",
  );
});

test("expires approval tokens after fifteen minutes and binds digest", async () => {
  const store = new InMemoryApprovalTokenStore();
  const issued = await store.issue({ campaignId: "C-1", envelopeDigest: "sha256:abc", now: "2026-07-21T12:00:00.000Z" });
  assert.equal(
    await store.consume({
      campaignId: "C-1",
      envelopeDigest: "sha256:def",
      approvalToken: issued.approvalToken,
      now: "2026-07-21T12:01:00.000Z",
    }),
    "stale",
  );
  assert.equal(
    await store.consume({
      campaignId: "C-1",
      envelopeDigest: "sha256:abc",
      approvalToken: issued.approvalToken,
      now: "2026-07-21T12:15:00.001Z",
    }),
    "expired",
  );
});

test("rejects credential class interchange between viewer and approval stores", async () => {
  const viewer = new InMemoryViewerSessionStore();
  const approval = new InMemoryApprovalTokenStore();
  const viewerIssued = await viewer.issue({ repositoryId: "repo-1", now: "2026-07-21T12:00:00.000Z" });
  const approvalIssued = await approval.issue({ campaignId: "C-1", envelopeDigest: "sha256:abc", now: "2026-07-21T12:00:00.000Z" });
  assert.equal(
    (await viewer.authorize({ viewerToken: approvalIssued.approvalToken, repositoryId: "repo-1", now: "2026-07-21T12:01:00.000Z" })).result,
    "invalid",
  );
  assert.equal(
    await approval.consume({
      campaignId: "C-1",
      envelopeDigest: "sha256:abc",
      approvalToken: viewerIssued.viewerToken,
      now: "2026-07-21T12:01:00.000Z",
    }),
    "invalid",
  );
});

test("consuming approval does not affect an independent viewer session", async () => {
  const viewer = new InMemoryViewerSessionStore();
  const approval = new InMemoryApprovalTokenStore();
  const viewerIssued = await viewer.issue({ repositoryId: "repo-1", now: "2026-07-21T12:00:00.000Z" });
  const approvalIssued = await approval.issue({ campaignId: "C-1", envelopeDigest: "sha256:abc", now: "2026-07-21T12:00:00.000Z" });
  assert.equal(
    await approval.consume({
      campaignId: "C-1",
      envelopeDigest: "sha256:abc",
      approvalToken: approvalIssued.approvalToken,
      now: "2026-07-21T12:01:00.000Z",
    }),
    "ok",
  );
  assert.equal(
    (await viewer.authorize({ viewerToken: viewerIssued.viewerToken, repositoryId: "repo-1", now: "2026-07-21T12:02:00.000Z" })).result,
    "authorized",
  );
});
