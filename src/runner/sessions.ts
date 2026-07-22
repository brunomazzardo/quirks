import { QuirksError } from "../core/errors.js";
import type { CampaignStore } from "../campaign/store.js";

export interface SessionRecord {
  schemaVersion: 1;
  jobId: string;
  role: "supervisor" | "implementer" | "reviewer";
  profileId: string;
  sessionHandle: string;
  pid: number;
  startedAt: string;
  lastHeartbeatAt: string;
  artifactPaths: readonly string[];
  terminalStatus?: string;
}

export interface SessionRegisterInput {
  jobId: string;
  role: SessionRecord["role"];
  profileId: string;
  sessionHandle: string;
  pid: number;
  artifactPaths: readonly string[];
}

export interface SessionUpdateInput {
  jobId: string;
  pid?: number;
  artifactPaths?: readonly string[];
  terminalStatus?: string;
}

interface SessionsDocument {
  schemaVersion: 1;
  sessions: SessionRecord[];
}

function assertSessionRecord(value: unknown): SessionRecord {
  if (typeof value !== "object" || value === null) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Session record must be an object");
  }
  const record = value as Partial<SessionRecord>;
  if (
    record.schemaVersion !== 1 ||
    typeof record.jobId !== "string" ||
    (record.role !== "supervisor" && record.role !== "implementer" && record.role !== "reviewer") ||
    typeof record.profileId !== "string" ||
    typeof record.sessionHandle !== "string" ||
    typeof record.pid !== "number" ||
    typeof record.startedAt !== "string" ||
    typeof record.lastHeartbeatAt !== "string" ||
    !Array.isArray(record.artifactPaths) ||
    record.artifactPaths.some((entry) => typeof entry !== "string") ||
    (record.terminalStatus !== undefined && typeof record.terminalStatus !== "string")
  ) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Malformed session record");
  }
  return {
    schemaVersion: 1,
    jobId: record.jobId,
    role: record.role,
    profileId: record.profileId,
    sessionHandle: record.sessionHandle,
    pid: record.pid,
    startedAt: record.startedAt,
    lastHeartbeatAt: record.lastHeartbeatAt,
    artifactPaths: [...record.artifactPaths],
    ...(record.terminalStatus === undefined ? {} : { terminalStatus: record.terminalStatus }),
  };
}

export class SessionRegistry {
  // Serializes read-modify-write cycles so concurrent register/update calls on
  // one registry instance cannot lose each other's session records.
  #writeChain: Promise<unknown> = Promise.resolve();

  private constructor(private readonly store: CampaignStore) {}

  static async open(store: CampaignStore): Promise<SessionRegistry> {
    await store.readSessionsDocument();
    return new SessionRegistry(store);
  }

  async register(input: SessionRegisterInput): Promise<SessionRecord> {
    return this.#serialized(() => this.#registerNow(input));
  }

  async update(input: SessionUpdateInput): Promise<SessionRecord> {
    return this.#serialized(() => this.#updateNow(input));
  }

  #serialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#writeChain.then(operation, operation);
    this.#writeChain = next.catch(() => undefined);
    return next;
  }

  async #registerNow(input: SessionRegisterInput): Promise<SessionRecord> {
    const document = await this.store.readSessionsDocument();
    if (document.sessions.some((session) => session.jobId === input.jobId)) {
      throw new QuirksError("PROTOCOL_VIOLATION", `Session already registered for job ${input.jobId}`);
    }
    const now = new Date().toISOString();
    const record: SessionRecord = {
      schemaVersion: 1,
      jobId: input.jobId,
      role: input.role,
      profileId: input.profileId,
      sessionHandle: input.sessionHandle,
      pid: input.pid,
      startedAt: now,
      lastHeartbeatAt: now,
      artifactPaths: [...input.artifactPaths],
    };
    await this.store.writeSessionsDocument({ schemaVersion: 1, sessions: [...document.sessions, record] });
    return record;
  }

  async #updateNow(input: SessionUpdateInput): Promise<SessionRecord> {
    const document = await this.store.readSessionsDocument();
    const index = document.sessions.findIndex((session) => session.jobId === input.jobId);
    if (index < 0) {
      throw new QuirksError("PROTOCOL_VIOLATION", `No session registered for job ${input.jobId}`);
    }
    const current = document.sessions[index];
    if (current === undefined) {
      throw new QuirksError("PROTOCOL_VIOLATION", `No session registered for job ${input.jobId}`);
    }
    const updated: SessionRecord = {
      ...current,
      pid: input.pid ?? current.pid,
      artifactPaths: input.artifactPaths ? [...input.artifactPaths] : current.artifactPaths,
      lastHeartbeatAt: new Date().toISOString(),
      ...(input.terminalStatus === undefined
        ? current.terminalStatus === undefined
          ? {}
          : { terminalStatus: current.terminalStatus }
        : { terminalStatus: input.terminalStatus }),
    };
    const sessions = [...document.sessions];
    sessions[index] = updated;
    await this.store.writeSessionsDocument({ schemaVersion: 1, sessions });
    return updated;
  }

  async list(): Promise<readonly SessionRecord[]> {
    const document = await this.store.readSessionsDocument();
    return document.sessions.map((session) => ({ ...session, artifactPaths: [...session.artifactPaths] }));
  }
}

export function parseSessionsDocument(value: unknown): SessionsDocument {
  if (typeof value !== "object" || value === null) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Sessions document must be an object");
  }
  const document = value as Partial<SessionsDocument>;
  if (document.schemaVersion !== 1 || !Array.isArray(document.sessions)) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Malformed sessions document");
  }
  return { schemaVersion: 1, sessions: document.sessions.map(assertSessionRecord) };
}
