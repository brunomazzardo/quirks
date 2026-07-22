import { QuirksError } from "../core/errors.js";
import { validateProvenanceCandidate } from "../provenance/validate.js";
import type { ProvenanceIteration, ProvenanceValidation } from "../provenance/types.js";
import type { TaskSource } from "../task-source/task-source.js";
import type { MutationRequest } from "../task-source/types.js";
import { reconcileMutation } from "../sync/reconciler.js";
import type { OutboxPort } from "../sync/types.js";

export interface LandingProvenanceInput {
  repositoryRoot: string;
  campaignId: string;
  taskId: string;
  landingCommit: string;
  expectedNativeRevision: string;
  source: TaskSource;
  outbox: OutboxPort;
  attachIdempotencyKey: string;
  completeIdempotencyKey: string;
  iterationId: string;
}

function buildLandingIteration(input: LandingProvenanceInput): ProvenanceIteration {
  return {
    id: input.iterationId,
    outcome: "completed",
    completionBoundary: "target-merge",
    campaignId: input.campaignId,
    landedCommit: input.landingCommit,
    acceptedCommit: input.landingCommit,
    commitRefs: [input.landingCommit],
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    outcomeReason: "Landing provenance write-back",
  };
}

async function requireAcknowledged(intentState: string, operation: string): Promise<void> {
  if (intentState !== "acknowledged") {
    throw new QuirksError("PROTOCOL_VIOLATION", `${operation} was not acknowledged before continuing`);
  }
}

function isAvailableCandidate(validation: ProvenanceValidation): boolean {
  return "availability" in validation && validation.availability === "available";
}

export async function writeLandingProvenance(input: LandingProvenanceInput): Promise<{ attached: boolean; completed: boolean }> {
  const candidate = { kind: "commit" as const, sha: input.landingCommit };
  const validation = await validateProvenanceCandidate(input.repositoryRoot, candidate);
  if (!isAvailableCandidate(validation)) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Landing commit is not a valid provenance candidate");
  }

  const attachRequest: MutationRequest = {
    schemaVersion: 1,
    operation: "attach-provenance",
    taskId: input.taskId,
    expectedNativeRevision: input.expectedNativeRevision,
    idempotencyKey: input.attachIdempotencyKey,
    input: { iteration: buildLandingIteration(input) },
  };

  const attachIntent = await reconcileMutation({
    campaignId: input.campaignId,
    outbox: input.outbox,
    source: input.source,
    request: attachRequest,
  });
  await requireAcknowledged(attachIntent.state, "attach-provenance");

  const showAfterAttach = await input.source.execute({
    schemaVersion: 1,
    operation: "show",
    taskId: input.taskId,
    input: {},
  });
  if (!showAfterAttach.ok) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Task show failed after attach-provenance");
  }

  const completeRequest: MutationRequest = {
    schemaVersion: 1,
    operation: "complete",
    taskId: input.taskId,
    expectedNativeRevision: showAfterAttach.nativeRevision ?? input.expectedNativeRevision,
    idempotencyKey: input.completeIdempotencyKey,
    input: { evidenceRefs: [`commit:${input.landingCommit}`] },
  };

  const completeIntent = await reconcileMutation({
    campaignId: input.campaignId,
    outbox: input.outbox,
    source: input.source,
    request: completeRequest,
  });
  await requireAcknowledged(completeIntent.state, "complete");

  return { attached: true, completed: true };
}

export async function assertLandingProvenanceReady(input: LandingProvenanceInput): Promise<void> {
  const candidate = { kind: "commit" as const, sha: input.landingCommit };
  const validation = await validateProvenanceCandidate(input.repositoryRoot, candidate);
  if (!isAvailableCandidate(validation)) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Landing commit is not a valid provenance candidate");
  }
}
