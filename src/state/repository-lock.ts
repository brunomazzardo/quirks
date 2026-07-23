import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import type { FileHandle } from "node:fs/promises";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { canonicalJson } from "../core/canonical-json.js";
import { QuirksError } from "../core/errors.js";
import { writeJsonAtomic } from "./atomic-file.js";
import type { RepositoryLockHandle, RepositoryLockRecord } from "./types.js";

export interface AcquireRepositoryLockOptions {
  campaignId: string;
  /**
   * Invoked after a dead-holder lock (same hostname, pid no longer alive) has
   * been stolen, with the displaced record. Callers use this to journal the
   * steal durably before the run proceeds.
   */
  onSteal?: (stale: RepositoryLockRecord) => void | Promise<void>;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user - treat as alive.
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function lockDetails(record: RepositoryLockRecord): Readonly<Record<string, string>> {
  return {
    campaignId: record.campaignId,
    pid: String(record.pid),
    hostname: record.hostname,
    acquiredAt: record.acquiredAt,
    heartbeatAt: record.heartbeatAt,
    scope: record.scope,
  };
}

function assertLockRecord(value: unknown): RepositoryLockRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Lock record must be an object");
  }

  const record = value as Record<string, unknown>;
  if (record["schemaVersion"] !== 1) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Lock record schemaVersion must be 1");
  }
  if (record["scope"] !== "local-clone") {
    throw new QuirksError("PROTOCOL_VIOLATION", "Lock record scope must be local-clone");
  }
  for (const field of ["campaignId", "hostname", "acquiredAt", "heartbeatAt"] as const) {
    if (typeof record[field] !== "string" || record[field].length === 0) {
      throw new QuirksError("PROTOCOL_VIOLATION", `Lock record field ${field} must be a non-empty string`);
    }
  }
  if (typeof record["pid"] !== "number" || !Number.isInteger(record["pid"]) || record["pid"] <= 0) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Lock record pid must be a positive integer");
  }

  return {
    schemaVersion: 1,
    scope: "local-clone",
    campaignId: record["campaignId"] as string,
    pid: record["pid"] as number,
    hostname: record["hostname"] as string,
    acquiredAt: record["acquiredAt"] as string,
    heartbeatAt: record["heartbeatAt"] as string,
  };
}

async function readLockRecord(lockPath: string): Promise<RepositoryLockRecord> {
  const contents = await readRawLock(lockPath);
  if (contents === undefined) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Lock file is unreadable");
  }
  return parseRawLock(contents);
}

function ownershipMatches(expected: RepositoryLockRecord, actual: RepositoryLockRecord): boolean {
  return (
    expected.campaignId === actual.campaignId &&
    expected.pid === actual.pid &&
    expected.hostname === actual.hostname &&
    expected.acquiredAt === actual.acquiredAt
  );
}

function assertHandleNotReleased(released: boolean): void {
  if (released) {
    throw new QuirksError("PROTOCOL_VIOLATION", "LOCK_ALREADY_RELEASED");
  }
}

async function readOwnedLockRecord(
  lockPath: string,
  expected: RepositoryLockRecord,
): Promise<RepositoryLockRecord> {
  let existing: RepositoryLockRecord;
  try {
    existing = await readLockRecord(lockPath);
  } catch {
    throw new QuirksError(
      "PROTOCOL_VIOLATION",
      "LOCK_NOT_OWNED: lock file is missing or unreadable",
      lockDetails(expected),
    );
  }

  if (!ownershipMatches(expected, existing)) {
    throw new QuirksError(
      "PROTOCOL_VIOLATION",
      `LOCK_NOT_OWNED: lock is held by campaign ${existing.campaignId}`,
      lockDetails(existing),
    );
  }

  return existing;
}

async function writeAll(handle: FileHandle, data: string): Promise<void> {
  let offset = 0;
  while (offset < data.length) {
    const { bytesWritten } = await handle.write(data, offset);
    offset += bytesWritten;
  }
}

function createHandle(lockPath: string, record: RepositoryLockRecord): RepositoryLockHandle {
  let released = false;

  return {
    scope: "local-clone",
    record,
    async heartbeat(): Promise<void> {
      assertHandleNotReleased(released);
      await readOwnedLockRecord(lockPath, record);
      record.heartbeatAt = new Date().toISOString();
      await writeJsonAtomic(lockPath, record);
    },
    async release(): Promise<void> {
      assertHandleNotReleased(released);
      await readOwnedLockRecord(lockPath, record);
      await rm(lockPath, { force: true });
      released = true;
    },
  };
}

/**
 * Deterministic per-stale-record steal token. Every stealer that judged the
 * same stale lock content derives the same path, so `open(..., "wx")` on it
 * is an atomic arbiter: exactly one stealer proceeds, losers back off without
 * ever mutating the lock. A token leaked by a stealer that crashed after
 * replacing the lock names a record that no longer exists, so it never blocks
 * stealing the next dead holder.
 */
export function stealTokenPath(lockPath: string, staleContent: string): string {
  const digest = createHash("sha256").update(staleContent).digest("hex");
  return `${lockPath}.steal-${digest.slice(0, 16)}`;
}

async function readRawLock(lockPath: string): Promise<string | undefined> {
  try {
    return await readFile(lockPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw new QuirksError("PROTOCOL_VIOLATION", "Lock file is unreadable");
  }
}

function parseRawLock(contents: string): RepositoryLockRecord {
  const line = contents.split("\n").find((entry) => entry.length > 0);
  if (line === undefined) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Lock file is empty");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new QuirksError("PROTOCOL_VIOLATION", "Lock file contains malformed JSON");
  }
  return assertLockRecord(parsed);
}

function heldBy(existing: RepositoryLockRecord, extraDetails: Record<string, string> = {}): QuirksError {
  return new QuirksError(
    "PROTOCOL_VIOLATION",
    `LOCAL_LOCK_HELD: repository lock is held by campaign ${existing.campaignId}`,
    { ...lockDetails(existing), ...extraDetails },
  );
}

async function writeExclusive(filePath: string, contents: string): Promise<boolean> {
  try {
    const handle = await open(filePath, "wx", 0o600);
    try {
      await writeAll(handle, contents);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return true;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    return false;
  }
}

/**
 * Displace a dead holder without the read-judge-rm-create race. The steal is
 * serialized by an atomic O_EXCL token derived from the stale content: only
 * the token winner may touch the lock, so a late stealer can never delete a
 * fresh lock created by an earlier winner. The replacement itself is a
 * rename, which atomically swaps the stale file for ours with no window in
 * which the lock path is missing.
 */
async function stealDeadHolderLock(
  lockPath: string,
  staleContent: string,
  ourContent: string,
  record: RepositoryLockRecord,
): Promise<"stolen" | "vanished"> {
  const tokenPath = stealTokenPath(lockPath, staleContent);
  if (!(await writeExclusive(tokenPath, ourContent))) {
    throw heldBy(parseRawLock(staleContent), { stealToken: tokenPath });
  }
  try {
    // Under the token: the lock must still be exactly the content we judged
    // dead; anything else means the world moved on and we must not touch it.
    const current = await readRawLock(lockPath);
    if (current === undefined) return "vanished";
    if (current !== staleContent) throw heldBy(parseRawLock(current));

    const replacementPath = `${lockPath}.${record.pid}.${randomUUID()}`;
    if (!(await writeExclusive(replacementPath, ourContent))) {
      throw new QuirksError("PROTOCOL_VIOLATION", "Lock replacement path collision");
    }
    await rename(replacementPath, lockPath);

    // Defense in depth: our rename must be the surviving lock.
    const settled = await readRawLock(lockPath);
    if (settled !== ourContent) {
      if (settled === undefined) {
        throw new QuirksError("PROTOCOL_VIOLATION", "LOCK_NOT_OWNED: lock file is missing or unreadable");
      }
      throw heldBy(parseRawLock(settled));
    }
    return "stolen";
  } finally {
    await rm(tokenPath, { force: true });
  }
}

// oxlint-disable typescript/no-extraneous-class -- static acquire API required by protocol
export class RepositoryLock {
  static async acquire(lockPath: string, options: AcquireRepositoryLockOptions): Promise<RepositoryLockHandle> {
    const now = new Date().toISOString();
    const record: RepositoryLockRecord = {
      schemaVersion: 1,
      scope: "local-clone",
      campaignId: options.campaignId,
      pid: process.pid,
      hostname: os.hostname(),
      acquiredAt: now,
      heartbeatAt: now,
    };
    const ourContent = `${canonicalJson(record)}\n`;

    await mkdir(path.dirname(lockPath), { recursive: true });

    // Bounded retries cover benign transitions (a holder releasing, or a dead
    // holder vanishing between phases); every contended outcome still throws.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await writeExclusive(lockPath, ourContent)) {
        return createHandle(lockPath, record);
      }

      const staleContent = await readRawLock(lockPath);
      if (staleContent === undefined) continue; // released between phases: retry create
      const existing = parseRawLock(staleContent);
      // Liveness can only be judged for pids on this host; a foreign hostname
      // (or an alive pid) keeps the lock with its recorded holder.
      const holderIsDead = existing.hostname === record.hostname && !isProcessAlive(existing.pid);
      if (!holderIsDead) throw heldBy(existing);

      const outcome = await stealDeadHolderLock(lockPath, staleContent, ourContent, record);
      if (outcome === "vanished") continue; // dead holder gone: plain create, not a steal
      await options.onSteal?.(existing);
      return createHandle(lockPath, record);
    }

    const contents = await readRawLock(lockPath);
    if (contents === undefined) {
      throw new QuirksError("PROTOCOL_VIOLATION", "LOCAL_LOCK_HELD: repository lock is contended");
    }
    throw heldBy(parseRawLock(contents));
  }
}
