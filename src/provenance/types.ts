export type EvidenceKind =
  | "configured-profile"
  | "authenticated-host"
  | "authenticated-provider"
  | "self-asserted"
  | "self-asserted-git-metadata"
  | "git-signature";

export type OperatorEvidenceKind = Exclude<EvidenceKind, "self-asserted-git-metadata" | "git-signature">;

export interface Identity {
  label: string;
  evidence: EvidenceKind;
  verified: boolean;
}

export type ArtifactKind = "spec" | "plan" | "review" | "other";

export interface ArtifactRef {
  kind: ArtifactKind;
  path: string;
  commit: string;
  url?: string;
  task?: number;
  section?: string;
  sections?: readonly number[];
}

export interface PullRequestRef {
  provider: string;
  repository: string;
  number: number;
  url: string;
  state: "open" | "closed" | "merged" | "draft";
  opener?: Identity;
  merger?: Identity;
  mergeCommit?: string;
}

export interface VerificationRef {
  kind: "verification" | "ci" | "build" | "release" | "deployment";
  reference: string;
  outcome: string;
}

export interface Participant {
  role: string;
  runner?: string;
  model?: string;
  effort?: "mechanical" | "standard" | "high" | "principal";
  sessionRef?: string;
}

export type CompletionBoundary = "accepted-commit" | "campaign-merge" | "target-merge" | "remote-push";

export type IterationOutcome = "completed" | "partial" | "failed" | "cancelled" | "blocked" | "superseded";

export interface ProvenanceIteration {
  id: string;
  outcome: IterationOutcome;
  completionBoundary: CompletionBoundary;
  campaignId?: string;
  taskRevision?: string;
  envelopeDigest?: string;
  baseCommit?: string;
  acceptedCommit?: string;
  landedCommit?: string;
  supersededBy?: string;
  artifactRefs?: readonly ArtifactRef[];
  commitRefs?: readonly string[];
  pullRequestRefs?: readonly PullRequestRef[];
  verificationRefs?: readonly VerificationRef[];
  participants?: readonly Participant[];
  operator?: Identity;
  gitAuthor?: Identity;
  gitCommitter?: Identity;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  usage?: string;
  cost?: string;
  deviations?: readonly string[];
  retries?: number;
  fallbacks?: readonly string[];
  permissionDenials?: readonly string[];
  timeouts?: readonly string[];
  resumptions?: readonly string[];
  followUpTaskRefs?: readonly string[];
  outcomeReason?: string;
}

export interface TaskProvenance {
  schemaVersion: 1;
  iterations: readonly ProvenanceIteration[];
}

export type ReferenceAvailability =
  | "available"
  | "missing-at-commit"
  | "invalid-commit"
  | "invalid-path"
  | "invalid-url"
  | "unavailable";

export interface ArtifactCandidate {
  kind: ArtifactKind;
  path: string;
  commit: string;
  url?: string;
}

export interface CommitCandidate {
  kind: "commit";
  sha: string;
}

export interface PullRequestCandidate {
  kind: "pull-request";
  provider: string;
  repository: string;
  number: number;
  url: string;
  state: "open" | "closed" | "merged" | "draft";
  mergeCommit?: string;
  opener?: OperatorCandidate;
  merger?: OperatorCandidate;
}

export interface OperatorCandidate {
  kind: "operator";
  label: string;
  evidence: OperatorEvidenceKind;
}

export interface UrlCandidate {
  kind: "url";
  url: string;
}

export type ProvenanceCandidate =
  | ArtifactCandidate
  | CommitCandidate
  | PullRequestCandidate
  | OperatorCandidate
  | UrlCandidate;

export interface ArtifactValidation {
  kind: ArtifactKind;
  path: string;
  commit: string;
  url?: string;
  availability: ReferenceAvailability;
  currentReplacement?: undefined;
}

export interface CommitValidation {
  kind: "commit";
  sha: string;
  availability: ReferenceAvailability;
  author?: Identity;
  committer?: Identity;
}

export interface PullRequestValidation {
  kind: "pull-request";
  provider: string;
  repository: string;
  number: number;
  url: string;
  state: "open" | "closed" | "merged" | "draft";
  availability: ReferenceAvailability;
  mergeCommit?: string;
  opener?: Identity;
  merger?: Identity;
}

export interface OperatorValidation {
  kind: "operator";
  label: string;
  evidence: OperatorEvidenceKind;
  verified: boolean;
}

export interface UrlValidation {
  kind: "url";
  url?: string;
  availability: ReferenceAvailability;
}

export type ProvenanceValidation =
  | ArtifactValidation
  | CommitValidation
  | PullRequestValidation
  | OperatorValidation
  | UrlValidation;

export interface ValidatedArtifactRef {
  ref: ArtifactRef;
  availability: ReferenceAvailability;
  content?: undefined;
}

export interface ValidatedCommitRef {
  sha: string;
  availability: ReferenceAvailability;
  author?: Identity;
  committer?: Identity;
}

export interface ValidatedPullRequestRef {
  ref: PullRequestRef;
  availability: ReferenceAvailability;
}

export interface TaskHistoryEntry {
  iteration: ProvenanceIteration;
  artifactRefs: readonly ValidatedArtifactRef[];
  commitRefs: readonly ValidatedCommitRef[];
  pullRequestRefs: readonly ValidatedPullRequestRef[];
  verificationRefs: readonly VerificationRef[];
  journalEventIds: readonly string[];
  derived: {
    commitCount: number;
  };
}

export interface TaskHistory {
  schemaVersion: 1;
  taskId: string;
  entries: readonly TaskHistoryEntry[];
  totalIterations: number;
  partialCount: number;
  supersededCount: number;
}

export const PROVENANCE_LIMITS = {
  iterations: 128,
  artifactRefs: 32,
  commitRefs: 256,
  pullRequestRefs: 16,
  verificationRefs: 32,
  participants: 32,
  deviations: 16,
  outcomeReasonBytes: 512,
  summaryBytes: 256,
} as const;

export type RepositoryLocatorValidator = (provider: string, repository: string) => boolean;
