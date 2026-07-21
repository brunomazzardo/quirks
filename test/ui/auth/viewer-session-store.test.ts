import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryViewerSessionStore } from "../../../src/ui/auth/viewer-session-store.js";

test("issues qkview_ tokens with eight-hour idle and twenty-four-hour absolute expiry", async () => {
  const store = new InMemoryViewerSessionStore();
  const issued = await store.issue({ repositoryId: "repo-1", now: "2026-07-21T00:00:00.000Z" });
  assert.match(issued.viewerToken, /^qkview_[A-Za-z0-9_-]{43}$/);
  assert.equal(issued.idleExpiresAt, "2026-07-21T08:00:00.000Z");
  assert.equal(issued.absoluteExpiresAt, "2026-07-22T00:00:00.000Z");
});

test("stores only hashed viewer credentials", async () => {
  const store = new InMemoryViewerSessionStore();
  const issued = await store.issue({ repositoryId: "repo-1", now: "2026-07-21T00:00:00.000Z" });
  assert.equal(store.hasPlaintextSecret(issued.viewerToken), false);
});
