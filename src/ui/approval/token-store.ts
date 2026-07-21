import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isViewerToken } from "../auth/viewer-session-store.js";

const APPROVAL_PREFIX = "qkapprove_";
const TTL_MS = 15 * 60 * 1000;

type ApprovalRecord = {
  campaignId: string;
  envelopeDigest: string;
  expiresAt: string;
  consumedAt?: string;
};

export type ApprovalConsumeResult = "ok" | "stale" | "expired" | "replay" | "invalid";

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

export function isApprovalToken(token: string): boolean {
  return token.startsWith(APPROVAL_PREFIX) && token.length === APPROVAL_PREFIX.length + 43;
}

function createApprovalToken(): string {
  return `${APPROVAL_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export class InMemoryApprovalTokenStore {
  #records = new Map<string, ApprovalRecord>();

  async issue(input: { campaignId: string; envelopeDigest: string; now?: string }): Promise<{
    approvalToken: string;
    expiresAt: string;
  }> {
    const now = input.now ?? new Date().toISOString();
    const approvalToken = createApprovalToken();
    const expiresAt = addMs(now, TTL_MS);
    this.#records.set(hashToken(approvalToken), {
      campaignId: input.campaignId,
      envelopeDigest: input.envelopeDigest,
      expiresAt,
    });
    return { approvalToken, expiresAt };
  }

  async consume(input: {
    campaignId: string;
    envelopeDigest: string;
    approvalToken: string;
    now?: string;
  }): Promise<ApprovalConsumeResult> {
    if (!isApprovalToken(input.approvalToken) || isViewerToken(input.approvalToken)) return "invalid";
    const record = this.#records.get(hashToken(input.approvalToken));
    if (!record) return "invalid";
    const now = input.now ?? new Date().toISOString();
    if (parseInstant(now) > parseInstant(record.expiresAt)) return "expired";
    if (!constantTimeEqual(record.campaignId, input.campaignId) || !constantTimeEqual(record.envelopeDigest, input.envelopeDigest)) {
      return "stale";
    }
    if (record.consumedAt) return "replay";
    record.consumedAt = now;
    return "ok";
  }
}
