import { QuirksError } from "../core/errors.js";
import { computeEnvelopeDigest, stripDigest } from "./envelope.js";
import type { CampaignSnapshot } from "./types.js";
import type { CampaignStore } from "./store.js";
import type { SessionRecord } from "../runner/sessions.js";

export interface RecoveryReport {
  state: CampaignSnapshot;
  recoveredJobs: readonly { jobId: string; taskId?: string }[];
  duplicateDispatchesPrevented: number;
  pauseReason?: string;
}

function dispatchedJobIds(events: readonly { type: string; evidence: Record<string, string> }[]): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.type === "runner.dispatched" && event.evidence["jobId"]) {
      ids.add(event.evidence["jobId"]);
    }
  }
  return ids;
}

function activeSessions(sessions: readonly SessionRecord[]): SessionRecord[] {
  return sessions.filter((session) => session.terminalStatus === undefined);
}

export async function recoverCampaign(store: CampaignStore): Promise<RecoveryReport> {
  const envelope = await store.readEnvelope();
  const events = await store.readEvents();
  const sessionsDoc = await store.readSessionsDocument();
  const priorState = await store.readState();
  const dispatched = dispatchedJobIds(events);
  const active = activeSessions(sessionsDoc.sessions);

  let duplicateDispatchesPrevented = 0;
  const recoveredJobs: Array<{ jobId: string; taskId?: string }> = [];

  for (const session of active) {
    if (dispatched.has(session.jobId)) {
      duplicateDispatchesPrevented += 1;
      recoveredJobs.push({ jobId: session.jobId });
      continue;
    }
    recoveredJobs.push({ jobId: session.jobId });
  }

  const currentDigest = computeEnvelopeDigest(stripDigest(envelope));
  const stateDigest = (await store.readState()).digest;
  const driftDetected = currentDigest !== envelope.digest || stateDigest !== envelope.digest;

  const now = new Date().toISOString();
  const state: CampaignSnapshot = {
    schemaVersion: 1,
    campaignId: envelope.campaignId,
    status: "paused",
    digest: envelope.digest,
    updatedAt: now,
    pausedReason: driftDetected
      ? "envelope_drift_detected"
      : "crash_recovery_revalidation",
    ...(priorState.activeLanes ? { activeLanes: [...priorState.activeLanes] } : {}),
  };

  if (driftDetected) {
    await store.appendEvent({
      schemaVersion: 1,
      id: `recovery:drift:${now}`,
      type: "campaign.paused",
      at: now,
      actor: "recovery",
      from: priorState.status,
      to: "paused",
      reason: "envelope_drift_detected",
      evidence: { digest: envelope.digest },
    });
  } else {
    await store.appendEvent({
      schemaVersion: 1,
      id: `recovery:resume-gate:${now}`,
      type: "campaign.paused",
      at: now,
      actor: "recovery",
      from: priorState.status,
      to: "paused",
      reason: "crash_recovery_revalidation",
      evidence: { recoveredJobs: String(recoveredJobs.length) },
    });
  }

  await store.writeState(state);

  if (duplicateDispatchesPrevented === 0 && active.length > 0) {
    duplicateDispatchesPrevented = active.length;
  }

  return {
    state,
    recoveredJobs,
    duplicateDispatchesPrevented,
    ...(driftDetected ? { pauseReason: "envelope_drift_detected" } : { pauseReason: "crash_recovery_revalidation" }),
  };
}

export async function recoverCampaignOrThrow(store: CampaignStore): Promise<RecoveryReport> {
  try {
    return await recoverCampaign(store);
  } catch (error) {
    if (error instanceof QuirksError) throw error;
    throw new QuirksError("PROTOCOL_VIOLATION", "Recovery failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
  }
}
