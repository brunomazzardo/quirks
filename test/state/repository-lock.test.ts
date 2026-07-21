import assert from "node:assert/strict";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalJson } from "../../src/core/canonical-json.js";
import { QuirksError } from "../../src/core/errors.js";
import { RepositoryLock } from "../../src/state/repository-lock.js";

test("permits one local writer and never calls the lock global", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-lock-"));
  const first = await RepositoryLock.acquire(path.join(dir, "lock"), { campaignId: "C-1" });
  await assert.rejects(
    () => RepositoryLock.acquire(path.join(dir, "lock"), { campaignId: "C-2" }),
    /LOCAL_LOCK_HELD/,
  );
  assert.equal(first.scope, "local-clone");
  await first.release();
});

test("removes the lock file on release", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-lock-"));
  const lockPath = path.join(dir, "lock");
  const handle = await RepositoryLock.acquire(lockPath, { campaignId: "C-1" });
  await handle.release();
  const replacement = await RepositoryLock.acquire(lockPath, { campaignId: "C-2" });
  assert.equal(replacement.record.campaignId, "C-2");
  await replacement.release();
});

test("returns stale lock metadata without removing it", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-lock-"));
  const lockPath = path.join(dir, "lock");
  const staleRecord = {
    schemaVersion: 1 as const,
    scope: "local-clone" as const,
    campaignId: "C-stale",
    pid: 99_999_999,
    hostname: "stale-host",
    acquiredAt: "2026-07-21T00:00:00.000Z",
    heartbeatAt: "2026-07-21T00:00:00.000Z",
  };
  await writeFile(lockPath, `${canonicalJson(staleRecord)}\n`, { mode: 0o600 });
  await assert.rejects(
    () => RepositoryLock.acquire(lockPath, { campaignId: "C-new" }),
    (error: unknown) => {
      assert.ok(error instanceof QuirksError);
      assert.match(error.message, /LOCAL_LOCK_HELD/);
      assert.equal(error.details["campaignId"], "C-stale");
      assert.equal(error.details["pid"], "99999999");
      assert.equal(error.details["hostname"], "stale-host");
      return true;
    },
  );
  await access(lockPath);
});

test("updates heartbeatAt on heartbeat", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-lock-"));
  const lockPath = path.join(dir, "lock");
  const handle = await RepositoryLock.acquire(lockPath, { campaignId: "C-1" });
  const before = handle.record.heartbeatAt;
  await handle.heartbeat();
  assert.notEqual(handle.record.heartbeatAt, before);
  await handle.release();
});

test("rejects heartbeat after release", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-lock-"));
  const lockPath = path.join(dir, "lock");
  const handle = await RepositoryLock.acquire(lockPath, { campaignId: "C-1" });
  await handle.release();
  await assert.rejects(() => handle.heartbeat(), /LOCK_ALREADY_RELEASED/);
});

test("double release under contention does not clobber the new owner", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-lock-"));
  const lockPath = path.join(dir, "lock");
  const first = await RepositoryLock.acquire(lockPath, { campaignId: "C-1" });
  await first.release();
  const second = await RepositoryLock.acquire(lockPath, { campaignId: "C-2" });
  await assert.rejects(() => first.release(), /LOCK_ALREADY_RELEASED/);
  await assert.rejects(() => first.heartbeat(), /LOCK_ALREADY_RELEASED/);
  await access(lockPath);
  assert.equal(second.record.campaignId, "C-2");
  await second.release();
});
