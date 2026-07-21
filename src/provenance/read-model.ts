import type { JournalEvent } from "../state/types.js";
import { validateProvenanceCandidate, type ValidateProvenanceOptions } from "./validate.js";
import type {
  ArtifactRef,
  OperatorEvidenceKind,
  ProvenanceIteration,
  PullRequestRef,
  TaskHistory,
  TaskHistoryEntry,
  TaskProvenance,
  ValidatedArtifactRef,
  ValidatedCommitRef,
  ValidatedPullRequestRef,
} from "./types.js";
import { PROVENANCE_LIMITS } from "./types.js";

export interface BuildTaskHistoryInput extends ValidateProvenanceOptions {
  repositoryRoot: string;
  taskId: string;
  sourceProvenance: TaskProvenance;
  campaignEvents?: readonly JournalEvent[];
}

function enforceIterationLimits(iteration: ProvenanceIteration): void {
  if ((iteration.artifactRefs?.length ?? 0) > PROVENANCE_LIMITS.artifactRefs) {
    throw new Error(`artifactRefs exceeds limit of ${PROVENANCE_LIMITS.artifactRefs}`);
  }
  if ((iteration.commitRefs?.length ?? 0) > PROVENANCE_LIMITS.commitRefs) {
    throw new Error(`commitRefs exceeds limit of ${PROVENANCE_LIMITS.commitRefs}`);
  }
  if ((iteration.pullRequestRefs?.length ?? 0) > PROVENANCE_LIMITS.pullRequestRefs) {
    throw new Error(`pullRequestRefs exceeds limit of ${PROVENANCE_LIMITS.pullRequestRefs}`);
  }
  if ((iteration.verificationRefs?.length ?? 0) > PROVENANCE_LIMITS.verificationRefs) {
    throw new Error(`verificationRefs exceeds limit of ${PROVENANCE_LIMITS.verificationRefs}`);
  }
  if (iteration.outcomeReason && Buffer.byteLength(iteration.outcomeReason, "utf8") > PROVENANCE_LIMITS.outcomeReasonBytes) {
    throw new Error(`outcomeReason exceeds ${PROVENANCE_LIMITS.outcomeReasonBytes} bytes`);
  }
}

async function validateArtifactRef(
  repositoryRoot: string,
  ref: ArtifactRef,
  options: ValidateProvenanceOptions,
): Promise<ValidatedArtifactRef> {
  const result = await validateProvenanceCandidate(repositoryRoot, {
    kind: ref.kind,
    path: ref.path,
    commit: ref.commit,
    ...(ref.url ? { url: ref.url } : {}),
  }, options);
  if (result.kind === "spec" || result.kind === "plan" || result.kind === "review" || result.kind === "other") {
    return { ref, availability: result.availability, content: undefined };
  }
  return { ref, availability: "unavailable", content: undefined };
}

async function validateCommitRef(
  repositoryRoot: string,
  sha: string,
  options: ValidateProvenanceOptions,
): Promise<ValidatedCommitRef> {
  const result = await validateProvenanceCandidate(repositoryRoot, { kind: "commit", sha }, options);
  if (result.kind !== "commit") {
    return { sha, availability: "unavailable" };
  }
  return {
    sha,
    availability: result.availability,
    ...(result.author ? { author: result.author } : {}),
    ...(result.committer ? { committer: result.committer } : {}),
  };
}

async function validatePullRequestRef(
  repositoryRoot: string,
  ref: PullRequestRef,
  options: ValidateProvenanceOptions,
): Promise<ValidatedPullRequestRef> {
  const openerEvidence = ref.opener?.evidence;
  const mergerEvidence = ref.merger?.evidence;
  const result = await validateProvenanceCandidate(repositoryRoot, {
    kind: "pull-request",
    provider: ref.provider,
    repository: ref.repository,
    number: ref.number,
    url: ref.url,
    state: ref.state,
    ...(ref.mergeCommit ? { mergeCommit: ref.mergeCommit } : {}),
    ...(ref.opener && openerEvidence && openerEvidence !== "self-asserted-git-metadata" && openerEvidence !== "git-signature"
      ? { opener: { kind: "operator", label: ref.opener.label, evidence: openerEvidence as OperatorEvidenceKind } }
      : {}),
    ...(ref.merger && mergerEvidence && mergerEvidence !== "self-asserted-git-metadata" && mergerEvidence !== "git-signature"
      ? { merger: { kind: "operator", label: ref.merger.label, evidence: mergerEvidence as OperatorEvidenceKind } }
      : {}),
  }, options);
  if (result.kind !== "pull-request") {
    return { ref, availability: "unavailable" };
  }
  return { ref, availability: result.availability };
}

function journalEventIdsForIteration(
  taskId: string,
  iterationId: string,
  campaignEvents: readonly JournalEvent[] | undefined,
): readonly string[] {
  if (!campaignEvents) return [];
  return campaignEvents
    .filter((event) => event.data["taskId"] === taskId && event.data["iterationId"] === iterationId)
    .map((event) => event.id);
}

async function buildEntry(
  repositoryRoot: string,
  iteration: ProvenanceIteration,
  taskId: string,
  campaignEvents: readonly JournalEvent[] | undefined,
  options: ValidateProvenanceOptions,
): Promise<TaskHistoryEntry> {
  enforceIterationLimits(iteration);
  const artifactRefs = await Promise.all(
    (iteration.artifactRefs ?? []).map((ref) => validateArtifactRef(repositoryRoot, ref, options)),
  );
  const commitRefs = await Promise.all(
    (iteration.commitRefs ?? []).map((sha) => validateCommitRef(repositoryRoot, sha, options)),
  );
  const pullRequestRefs = await Promise.all(
    (iteration.pullRequestRefs ?? []).map((ref) => validatePullRequestRef(repositoryRoot, ref, options)),
  );

  return {
    iteration,
    artifactRefs,
    commitRefs,
    pullRequestRefs,
    verificationRefs: [...(iteration.verificationRefs ?? [])],
    journalEventIds: journalEventIdsForIteration(taskId, iteration.id, campaignEvents),
    derived: { commitCount: commitRefs.filter((ref) => ref.availability === "available").length },
  };
}

export async function buildTaskHistory(input: BuildTaskHistoryInput): Promise<TaskHistory> {
  const iterations = [...input.sourceProvenance.iterations];
  if (iterations.length > PROVENANCE_LIMITS.iterations) {
    throw new Error(`iterations exceeds limit of ${PROVENANCE_LIMITS.iterations}`);
  }

  const entries = await Promise.all(
    iterations.map((iteration) => buildEntry(
      input.repositoryRoot,
      iteration,
      input.taskId,
      input.campaignEvents,
      input,
    )),
  );

  return {
    schemaVersion: 1,
    taskId: input.taskId,
    entries,
    totalIterations: entries.length,
    partialCount: entries.filter((entry) => entry.iteration.outcome === "partial").length,
    supersededCount: entries.filter((entry) => entry.iteration.outcome === "superseded").length,
  };
}
