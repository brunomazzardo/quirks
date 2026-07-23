import { QuirksError } from "../core/errors.js";
import { CampaignStore } from "./store.js";
import type { CampaignEnvelope, CampaignStatus } from "./types.js";

export type StagingOutcome = "created" | "unchanged" | "replaced";

export interface StageCampaignEnvelopeInput {
  stateDir: string;
  envelope: CampaignEnvelope;
}

export interface StageCampaignEnvelopeResult {
  store: CampaignStore;
  outcome: StagingOutcome;
}

// A stored envelope may only be replaced while the campaign is still staged
// work: awaiting approval, or cancelled before anything ran.
const RESTAGEABLE_STATUSES = new Set<CampaignStatus>(["awaiting_approval", "cancelled"]);

/**
 * Persist a freshly preflighted envelope with create-once-or-replace
 * semantics.
 *
 * - New campaign: the store is created (`created`).
 * - Same digest already stored: nothing changes (`unchanged`).
 * - Different digest, campaign awaiting approval or cancelled, and no
 *   approval has been recorded against work that ran (no dispatched jobs):
 *   the stored envelope is replaced, an `envelope.replaced` event carrying
 *   the old and new digests is journaled, and the campaign returns to
 *   `awaiting_approval` bound to the new digest (`replaced`).
 * - Otherwise: refuse loudly, naming the stored digest so the operator can
 *   act without hunting through the state directory.
 *
 * Replay protection is preserved by construction: approvals are bound to the
 * envelope digest, so approvals recorded against the replaced envelope never
 * authorize the replacement.
 */
export async function stageCampaignEnvelope(input: StageCampaignEnvelopeInput): Promise<StageCampaignEnvelopeResult> {
  const { stateDir, envelope } = input;
  try {
    const store = await CampaignStore.create({
      stateDir,
      repositoryId: envelope.repositoryId,
      campaignId: envelope.campaignId,
      envelope,
    });
    return { store, outcome: "created" };
  } catch (error) {
    if (!(error instanceof QuirksError && error.message.includes("already exists"))) throw error;
  }

  const store = await CampaignStore.open(stateDir, envelope.repositoryId, envelope.campaignId);
  const stored = await store.readEnvelope();
  if (stored.digest === envelope.digest) return { store, outcome: "unchanged" };

  const state = await store.readState();
  const approvals = await store.readApprovals();
  const events = await store.readEvents();
  const dispatchedJobs = events.some((event) => event.type === "runner.dispatched");
  const approvedWorkRan = approvals.length > 0 && dispatchedJobs;

  if (!RESTAGEABLE_STATUSES.has(state.status) || approvedWorkRan) {
    throw new QuirksError(
      "PROTOCOL_VIOLATION",
      `ENVELOPE_REPLACE_REFUSED: campaign ${envelope.campaignId} is ${state.status} with stored envelope digest ` +
        `${stored.digest}; the fresh preflight envelope (digest ${envelope.digest}) was not persisted. ` +
        "Approve or cancel the stored envelope, or stage a new campaign with --campaign.",
      {
        campaignId: envelope.campaignId,
        status: state.status,
        storedDigest: stored.digest,
        freshDigest: envelope.digest,
        approvals: String(approvals.length),
        dispatchedJobs: String(dispatchedJobs),
      },
    );
  }

  await store.replaceEnvelope(envelope);
  const at = new Date().toISOString();
  await store.appendEvent({
    schemaVersion: 1,
    id: `envelope:replaced:${envelope.digest}`,
    type: "envelope.replaced",
    at,
    actor: "control-plane",
    from: state.status,
    to: "awaiting_approval",
    reason: "preflight_restaged",
    evidence: { oldDigest: stored.digest, newDigest: envelope.digest },
  });
  await store.writeState({
    schemaVersion: 1,
    campaignId: envelope.campaignId,
    status: "awaiting_approval",
    digest: envelope.digest,
    updatedAt: at,
  });
  return { store, outcome: "replaced" };
}
