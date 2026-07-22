import { QuirksError } from "../core/errors.js";
import type { CampaignEvent, CampaignSnapshot, CampaignStatus } from "./types.js";

const transitions: Readonly<Record<CampaignStatus, readonly CampaignStatus[]>> = {
  draft: ["preflight", "cancelled"],
  preflight: ["awaiting_approval", "cancelled"],
  awaiting_approval: ["running", "cancelled"],
  running: ["paused", "blocked", "final_review", "hold", "cancelled"],
  paused: ["running", "blocked", "cancelled"],
  blocked: ["running", "paused", "cancelled"],
  final_review: ["landing", "hold"],
  landing: ["complete", "hold"],
  hold: [],
  complete: [],
  cancelled: [],
};

// Terminal means no outgoing transition exists in the table above; today that
// is exactly `hold`, `complete`, and `cancelled`. Every other status is
// resumable/attachable and therefore a resume candidate.
export function isTerminalCampaignStatus(status: CampaignStatus): boolean {
  return transitions[status].length === 0;
}

export function assertTransition(from: CampaignStatus, to: CampaignStatus): void {
  if (!transitions[from].includes(to)) {
    throw new QuirksError("PROTOCOL_VIOLATION", "ILLEGAL_TRANSITION", { from, to });
  }
}

export function initialSnapshot(campaignId: string, digest: string, updatedAt = new Date().toISOString()): CampaignSnapshot {
  return { schemaVersion: 1, campaignId, status: "draft", digest, updatedAt };
}

export function applyEvent(snapshot: CampaignSnapshot, event: CampaignEvent): CampaignSnapshot {
  if (snapshot.status !== event.from) {
    throw new QuirksError("PROTOCOL_VIOLATION", "TORN_EVENT_SEQUENCE", { expected: snapshot.status, actual: event.from });
  }
  assertTransition(event.from, event.to);
  const next: CampaignSnapshot = { ...snapshot, status: event.to, updatedAt: event.at };
  if (event.to === "paused") next.pausedReason = event.reason;
  if (event.to === "blocked") next.blockedReason = event.reason;
  return next;
}
