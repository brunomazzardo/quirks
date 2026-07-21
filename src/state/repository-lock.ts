import os from "node:os";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { canonicalJson } from "../core/canonical-json.js";
import { QuirksError } from "../core/errors.js";
import { writeJsonAtomic } from "./atomic-file.js";
import type { RepositoryLockHandle, RepositoryLockRecord } from "./types.js";

export interface AcquireRepositoryLockOptions {
  campaignId: string;
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
  let contents: string;
  try {
    contents = await readFile(lockPath, "utf8");
  } catch {
    throw new QuirksError("PROTOCOL_VIOLATION", "Lock file is unreadable");
  }

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

function createHandle(lockPath: string, record: RepositoryLockRecord): RepositoryLockHandle {
  return {
    scope: "local-clone",
    record,
    async heartbeat(): Promise<void> {
      record.heartbeatAt = new Date().toISOString();
      await writeJsonAtomic(lockPath, record);
    },
    async release(): Promise<void> {
      await rm(lockPath, { force: true });
    },
  };
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

    await mkdir(path.dirname(lockPath), { recursive: true });

    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.write(`${canonicalJson(record)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;

      const existing = await readLockRecord(lockPath);
      throw new QuirksError(
        "PROTOCOL_VIOLATION",
        `LOCAL_LOCK_HELD: repository lock is held by campaign ${existing.campaignId}`,
        lockDetails(existing),
      );
    }

    return createHandle(lockPath, record);
  }
}
