import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { QuirksError } from "../core/errors.js";
import type { CampaignApproval } from "./types.js";
import type { CampaignStore } from "./store.js";

const MAX_TTL_MS = 15 * 60 * 1000;
interface ChallengeRecord { tokenId: string; campaignId: string; digest: string; expiresAt: string; consumedAt?: string }
const challenges = new Map<string, ChallengeRecord>();
export type ApprovalOperator = CampaignApproval["operator"];

export function createApprovalChallenge(input: { campaignId: string; digest: string; ttlMs?: number }): { token: string; tokenId: string; expiresAt: string } {
  const ttlMs = Math.max(0, Math.min(input.ttlMs ?? MAX_TTL_MS, MAX_TTL_MS));
  const tokenId = createHash("sha256").update(randomBytes(32)).digest("hex");
  const token = createHash("sha256").update(`${tokenId}:${input.campaignId}:${input.digest}:${randomBytes(16).toString("hex")}`).digest("hex");
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  challenges.set(token, { tokenId, campaignId: input.campaignId, digest: input.digest, expiresAt });
  return { token, tokenId, expiresAt };
}

function digestMismatch(storedDigest: string): QuirksError {
  // The stored digest is the one approval must target; naming it saves the
  // operator from hunting through the state directory after a re-staging.
  return new QuirksError(
    "PROTOCOL_VIOLATION",
    `DIGEST_MISMATCH: stored envelope digest is ${storedDigest}`,
    { storedDigest },
  );
}

export async function consumeApprovalToken(input: { store: CampaignStore; token: string; campaignId: string; digest: string; operator: ApprovalOperator }): Promise<CampaignApproval> {
  const record = challenges.get(input.token);
  if (!record) throw new QuirksError("PROTOCOL_VIOLATION", "Unknown approval token");
  if (record.campaignId !== input.campaignId) throw new QuirksError("PROTOCOL_VIOLATION", "CAMPAIGN_MISMATCH");
  const envelope = await input.store.readEnvelope();
  const expected = Buffer.from(record.digest);
  const received = Buffer.from(input.digest);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw digestMismatch(envelope.digest);
  if (record.consumedAt) throw new QuirksError("PROTOCOL_VIOLATION", "APPROVAL_REPLAY");
  if (Date.parse(record.expiresAt) <= Date.now()) throw new QuirksError("PROTOCOL_VIOLATION", "APPROVAL_EXPIRED");
  if (envelope.digest !== input.digest) throw digestMismatch(envelope.digest);
  const existing = await input.store.readApprovals();
  const durable = existing.find((approval) => approval.digest === input.digest);
  if (durable) {
    // A fresh token approving the already-durably-approved current digest is
    // an operator retry (for example after an A -> B -> A re-stage carried
    // the approval forward), not a replay attack: return the original
    // approval idempotently. Reusing a consumed token still fails above.
    record.consumedAt = new Date().toISOString();
    return durable;
  }
  const approvedAt = new Date().toISOString();
  const approval: CampaignApproval = { schemaVersion: 1, campaignId: input.campaignId, digest: input.digest, approvedAt, operator: input.operator, tokenId: record.tokenId, evidence: { channel: "headless" } };
  await input.store.appendApproval(approval);
  await input.store.appendEvent({ schemaVersion: 1, id: `approval:${record.tokenId}`, type: "approval.recorded", at: approvedAt, actor: input.operator.id, from: "awaiting_approval", to: "running", reason: "operator_approved", evidence: { digest: input.digest, tokenId: record.tokenId } });
  record.consumedAt = approvedAt;
  return approval;
}

export async function hasDurableApproval(store: CampaignStore, digest: string): Promise<boolean> {
  return (await store.readApprovals()).some((approval) => approval.digest === digest);
}
