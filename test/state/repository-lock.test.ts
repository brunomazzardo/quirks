import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalJson } from "../../src/core/canonical-json.js";
import { QuirksError } from "../../src/core/errors.js";
import { RepositoryLock, stealTokenPath } from "../../src/state/repository-lock.js";
import type { RepositoryLockRecord } from "../../src/state/types.js";

// A pid far above any platform pid_max: process.kill(pid, 0) throws ESRCH.
const DEAD_PID = 99_999_999;

function lockRecord(overrides: Partial<RepositoryLockRecord> = {}): RepositoryLockRecord {
  return {
    schemaVersion: 1,
    scope: "local-clone",
    campaignId: "C-holder",
    pid: DEAD_PID,
    hostname: os.hostname(),
    acquiredAt: "2026-07-23T00:00:00.000Z",
    heartbeatAt: "2026-07-23T00:00:00.000Z",
    ...overrides,
  };
}

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

test("steals a dead-holder lock on the same host and reports the stale record", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-lock-"));
  const lockPath = path.join(dir, "lock");
  const stale = lockRecord({ campaignId: "C-dead" });
  await writeFile(lockPath, `${canonicalJson(stale)}\n`, { mode: 0o600 });

  const stolen: RepositoryLockRecord[] = [];
  const handle = await RepositoryLock.acquire(lockPath, {
    campaignId: "C-new",
    onSteal: (record) => {
      stolen.push(record);
    },
  });

  assert.equal(handle.record.campaignId, "C-new");
  assert.deepEqual(stolen, [stale], "the steal must report the dead holder it displaced");
  const contents = await readFile(lockPath, "utf8");
  assert.match(contents, /C-new/);
  assert.doesNotMatch(contents, /C-dead/);
  await handle.release();
});

test("a stealer that arrives while another steal is in progress backs off destroying nothing", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-lock-"));
  const lockPath = path.join(dir, "lock");
  const stale = lockRecord({ campaignId: "C-dead" });
  const staleContent = `${canonicalJson(stale)}\n`;
  await writeFile(lockPath, staleContent, { mode: 0o600 });
  // Another stealer already won the per-stale-record token: the late arriver
  // must never rm or replace anything - that is exactly the interleaving that
  // used to let a late stale rm delete the winner's fresh lock.
  const tokenPath = stealTokenPath(lockPath, staleContent);
  await writeFile(tokenPath, "competitor\n", { mode: 0o600 });

  const stolen: RepositoryLockRecord[] = [];
  await assert.rejects(
    () => RepositoryLock.acquire(lockPath, {
      campaignId: "C-late",
      onSteal: (record) => {
        stolen.push(record);
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof QuirksError);
      assert.match(error.message, /LOCAL_LOCK_HELD/);
      assert.equal(error.details["stealToken"], tokenPath);
      return true;
    },
  );
  assert.deepEqual(stolen, []);
  assert.equal(await readFile(lockPath, "utf8"), staleContent, "the late stealer must not touch the lock");
  assert.equal(await readFile(tokenPath, "utf8"), "competitor\n", "the late stealer must not touch the token");
});

test("concurrent stealers of the same dead holder produce exactly one owner", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-lock-"));
  const lockPath = path.join(dir, "lock");
  await writeFile(lockPath, `${canonicalJson(lockRecord({ campaignId: "C-dead" }))}\n`, { mode: 0o600 });

  const steals: string[] = [];
  const results = await Promise.allSettled([
    RepositoryLock.acquire(lockPath, {
      campaignId: "C-racer-a",
      onSteal: () => {
        steals.push("C-racer-a");
      },
    }),
    RepositoryLock.acquire(lockPath, {
      campaignId: "C-racer-b",
      onSteal: () => {
        steals.push("C-racer-b");
      },
    }),
  ]);

  const winners = results.filter((result) => result.status === "fulfilled");
  const losers = results.filter((result) => result.status === "rejected");
  assert.equal(winners.length, 1, "exactly one stealer may win");
  assert.equal(losers.length, 1, "the other stealer must back off");
  assert.match(String((losers[0] as PromiseRejectedResult).reason), /LOCAL_LOCK_HELD/);

  const winner = (winners[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof RepositoryLock.acquire>>>).value;
  const surviving = await readFile(lockPath, "utf8");
  assert.match(surviving, new RegExp(winner.record.campaignId), "the surviving lock belongs to the winner");
  assert.deepEqual(steals, [winner.record.campaignId], "only the winner journals a steal");
  await winner.release();
});

test("removes the steal token after a successful steal so later dead holders stay stealable", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-lock-"));
  const lockPath = path.join(dir, "lock");
  const firstStale = `${canonicalJson(lockRecord({ campaignId: "C-dead-1" }))}\n`;
  await writeFile(lockPath, firstStale, { mode: 0o600 });

  const first = await RepositoryLock.acquire(lockPath, { campaignId: "C-next-1" });
  await assert.rejects(() => access(stealTokenPath(lockPath, firstStale)), "the winner must clean up its token");
  await first.release();

  const secondStale = `${canonicalJson(lockRecord({ campaignId: "C-dead-2" }))}\n`;
  await writeFile(lockPath, secondStale, { mode: 0o600 });
  const second = await RepositoryLock.acquire(lockPath, { campaignId: "C-next-2" });
  assert.equal(second.record.campaignId, "C-next-2");
  await second.release();
});

test("does not steal a lock whose holder is alive on this host", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-lock-"));
  const lockPath = path.join(dir, "lock");
  const alive = lockRecord({ campaignId: "C-alive", pid: process.pid });
  const content = `${canonicalJson(alive)}\n`;
  await writeFile(lockPath, content, { mode: 0o600 });

  const stolen: RepositoryLockRecord[] = [];
  await assert.rejects(
    () => RepositoryLock.acquire(lockPath, {
      campaignId: "C-new",
      onSteal: (record) => {
        stolen.push(record);
      },
    }),
    /LOCAL_LOCK_HELD/,
  );
  assert.deepEqual(stolen, []);
  assert.equal(await readFile(lockPath, "utf8"), content, "an alive holder's lock file must be untouched");
});

test("does not steal a dead-pid lock recorded for a different host", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-lock-"));
  const lockPath = path.join(dir, "lock");
  const foreign = lockRecord({ campaignId: "C-foreign", hostname: "another-host" });
  const content = `${canonicalJson(foreign)}\n`;
  await writeFile(lockPath, content, { mode: 0o600 });

  await assert.rejects(
    () => RepositoryLock.acquire(lockPath, { campaignId: "C-new" }),
    /LOCAL_LOCK_HELD/,
  );
  assert.equal(await readFile(lockPath, "utf8"), content, "pid liveness cannot be judged for another host");
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

test("rejects heartbeat and release when lock file ownership no longer matches", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-lock-"));
  const lockPath = path.join(dir, "lock");
  const handle = await RepositoryLock.acquire(lockPath, { campaignId: "C-1" });

  const successorRecord = {
    schemaVersion: 1 as const,
    scope: "local-clone" as const,
    campaignId: "C-2",
    pid: 99_999_999,
    hostname: "other-host",
    acquiredAt: "2026-07-21T01:00:00.000Z",
    heartbeatAt: "2026-07-21T01:00:00.000Z",
  };
  const successorContent = `${canonicalJson(successorRecord)}\n`;
  await writeFile(lockPath, successorContent, { mode: 0o600 });

  const assertNotOwned = (error: unknown) => {
    assert.ok(error instanceof QuirksError);
    assert.match(error.message, /LOCK_NOT_OWNED/);
    assert.equal(error.details["campaignId"], "C-2");
    assert.equal(error.details["hostname"], "other-host");
    return true;
  };

  await assert.rejects(() => handle.heartbeat(), assertNotOwned);
  await assert.rejects(() => handle.release(), assertNotOwned);

  const after = await readFile(lockPath, "utf8");
  assert.equal(after, successorContent);
});

test("rejects heartbeat and release when lock file is missing", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-lock-"));
  const lockPath = path.join(dir, "lock");
  const handle = await RepositoryLock.acquire(lockPath, { campaignId: "C-1" });
  await rm(lockPath, { force: true });

  const assertNotOwned = (error: unknown) => {
    assert.ok(error instanceof QuirksError);
    assert.match(error.message, /LOCK_NOT_OWNED: lock file is missing or unreadable/);
    assert.equal(error.details["campaignId"], "C-1");
    return true;
  };

  await assert.rejects(() => handle.heartbeat(), assertNotOwned);
  await assert.rejects(() => handle.release(), assertNotOwned);
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
