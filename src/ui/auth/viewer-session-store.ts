import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const VIEWER_PREFIX = "qkview_";
const IDLE_MS = 8 * 60 * 60 * 1000;
const ABSOLUTE_MS = 24 * 60 * 60 * 1000;

type ViewerRecord = {
  repositoryId: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseInstant(value: string): number {
  return Date.parse(value);
}

function addMs(iso: string, ms: number): string {
  return new Date(parseInstant(iso) + ms).toISOString();
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isViewerToken(token: string): boolean {
  return token.startsWith(VIEWER_PREFIX) && token.length === VIEWER_PREFIX.length + 43;
}

function createViewerToken(): string {
  return `${VIEWER_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export class InMemoryViewerSessionStore {
  #records = new Map<string, ViewerRecord>();

  hasPlaintextSecret(token: string): boolean {
    return this.#records.has(token);
  }

  async issue(input: { repositoryId: string; now?: string }): Promise<{
    viewerToken: string;
    idleExpiresAt: string;
    absoluteExpiresAt: string;
  }> {
    const now = input.now ?? new Date().toISOString();
    const viewerToken = createViewerToken();
    const idleExpiresAt = addMs(now, IDLE_MS);
    const absoluteExpiresAt = addMs(now, ABSOLUTE_MS);
    this.#records.set(hashToken(viewerToken), {
      repositoryId: input.repositoryId,
      idleExpiresAt,
      absoluteExpiresAt,
    });
    return { viewerToken, idleExpiresAt, absoluteExpiresAt };
  }

  async authorize(input: { viewerToken: string; repositoryId: string; now?: string }): Promise<
    | { result: "authorized"; repositoryId: string; idleExpiresAt: string; absoluteExpiresAt: string }
    | { result: "expired" | "invalid" }
  > {
    if (!isViewerToken(input.viewerToken)) return { result: "invalid" };
    const record = this.#records.get(hashToken(input.viewerToken));
    if (!record || !constantTimeEqual(record.repositoryId, input.repositoryId)) return { result: "invalid" };
    const now = input.now ?? new Date().toISOString();
    const nowMs = parseInstant(now);
    if (nowMs > parseInstant(record.absoluteExpiresAt)) return { result: "expired" };
    const idleMs = parseInstant(record.idleExpiresAt);
    const canCapAtAbsolute = nowMs + IDLE_MS >= parseInstant(record.absoluteExpiresAt);
    if (nowMs > idleMs && !canCapAtAbsolute) return { result: "expired" };
    const nextIdle = addMs(now, IDLE_MS);
    record.idleExpiresAt =
      parseInstant(nextIdle) < parseInstant(record.absoluteExpiresAt) ? nextIdle : record.absoluteExpiresAt;
    return {
      result: "authorized",
      repositoryId: record.repositoryId,
      idleExpiresAt: record.idleExpiresAt,
      absoluteExpiresAt: record.absoluteExpiresAt,
    };
  }
}
