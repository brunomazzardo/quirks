import {
  commitExists,
  isValidGitSha,
  labelGitIdentity,
  pathExistsAtCommit,
  readCommitIdentities,
  verifyCommitSignature,
} from "./git-evidence.js";
import { isValidHttpsUrl, labelOperatorIdentity, validatePullRequestUrl } from "./provider-evidence.js";
import type {
  ArtifactValidation,
  CommitValidation,
  OperatorValidation,
  ProvenanceCandidate,
  ProvenanceValidation,
  PullRequestValidation,
  RepositoryLocatorValidator,
  UrlValidation,
} from "./types.js";
import { assertRepositoryRelativePath } from "../core/repository-path.js";
import { QuirksError } from "../core/errors.js";

export interface ValidateProvenanceOptions {
  allowedSigners?: readonly string[];
  validateRepositoryLocator?: RepositoryLocatorValidator;
}

async function validateArtifact(
  repositoryRoot: string,
  candidate: Extract<ProvenanceCandidate, { kind: "spec" | "plan" | "review" | "other" }>,
): Promise<ArtifactValidation> {
  if (!isValidGitSha(candidate.commit)) {
    return {
      kind: candidate.kind,
      path: candidate.path,
      commit: candidate.commit,
      availability: "invalid-commit",
    };
  }

  let path: string;
  try {
    path = assertRepositoryRelativePath(candidate.path);
  } catch {
    return {
      kind: candidate.kind,
      path: candidate.path,
      commit: candidate.commit,
      availability: "invalid-path",
    };
  }

  if (candidate.url && !isValidHttpsUrl(candidate.url)) {
    return {
      kind: candidate.kind,
      path,
      commit: candidate.commit,
      availability: "invalid-url",
    };
  }

  if (!(await commitExists(repositoryRoot, candidate.commit))) {
    return {
      kind: candidate.kind,
      path,
      commit: candidate.commit,
      availability: "invalid-commit",
    };
  }

  if (!(await pathExistsAtCommit(repositoryRoot, candidate.commit, path))) {
    return {
      kind: candidate.kind,
      path,
      commit: candidate.commit,
      availability: "missing-at-commit",
      currentReplacement: undefined,
    };
  }

  return {
    kind: candidate.kind,
    path,
    commit: candidate.commit,
    ...(candidate.url ? { url: candidate.url } : {}),
    availability: "available",
  };
}

async function validateCommit(
  repositoryRoot: string,
  candidate: Extract<ProvenanceCandidate, { kind: "commit" }>,
  options: ValidateProvenanceOptions,
): Promise<CommitValidation> {
  if (!isValidGitSha(candidate.sha)) {
    return { kind: "commit", sha: candidate.sha, availability: "invalid-commit" };
  }
  if (!(await commitExists(repositoryRoot, candidate.sha))) {
    return { kind: "commit", sha: candidate.sha, availability: "invalid-commit" };
  }

  const identities = await readCommitIdentities(repositoryRoot, candidate.sha);
  const signature = await verifyCommitSignature(repositoryRoot, candidate.sha, options.allowedSigners ?? []);
  const authorVerified = signature.verified;
  const committerVerified = signature.verified;

  return {
    kind: "commit",
    sha: candidate.sha,
    availability: "available",
    author: labelGitIdentity(identities.author, authorVerified),
    committer: labelGitIdentity(identities.committer, committerVerified),
  };
}

function validatePullRequest(
  candidate: Extract<ProvenanceCandidate, { kind: "pull-request" }>,
  options: ValidateProvenanceOptions,
): PullRequestValidation {
  if (!isValidHttpsUrl(candidate.url)) {
    return {
      kind: "pull-request",
      provider: candidate.provider,
      repository: candidate.repository,
      number: candidate.number,
      url: candidate.url,
      state: candidate.state,
      availability: "invalid-url",
    };
  }

  try {
    validatePullRequestUrl(
      candidate.url,
      candidate.provider,
      candidate.repository,
      options.validateRepositoryLocator,
    );
  } catch {
    return {
      kind: "pull-request",
      provider: candidate.provider,
      repository: candidate.repository,
      number: candidate.number,
      url: candidate.url,
      state: candidate.state,
      availability: "unavailable",
    };
  }

  if (candidate.mergeCommit && !isValidGitSha(candidate.mergeCommit)) {
    return {
      kind: "pull-request",
      provider: candidate.provider,
      repository: candidate.repository,
      number: candidate.number,
      url: candidate.url,
      state: candidate.state,
      availability: "invalid-commit",
    };
  }

  return {
    kind: "pull-request",
    provider: candidate.provider,
    repository: candidate.repository,
    number: candidate.number,
    url: candidate.url,
    state: candidate.state,
    availability: "available",
    ...(candidate.mergeCommit ? { mergeCommit: candidate.mergeCommit } : {}),
    ...(candidate.opener ? { opener: labelOperatorIdentity(candidate.opener.label, candidate.opener.evidence) } : {}),
    ...(candidate.merger ? { merger: labelOperatorIdentity(candidate.merger.label, candidate.merger.evidence) } : {}),
  };
}

function validateOperator(candidate: Extract<ProvenanceCandidate, { kind: "operator" }>): OperatorValidation {
  const identity = labelOperatorIdentity(candidate.label, candidate.evidence);
  return {
    kind: "operator",
    label: identity.label,
    evidence: candidate.evidence,
    verified: identity.verified,
  };
}

function validateUrl(candidate: Extract<ProvenanceCandidate, { kind: "url" }>): UrlValidation {
  if (!isValidHttpsUrl(candidate.url)) {
    return { kind: "url", availability: "invalid-url" };
  }
  return { kind: "url", url: candidate.url, availability: "available" };
}

export async function validateProvenanceCandidate(
  repositoryRoot: string,
  candidate: ProvenanceCandidate,
  options: ValidateProvenanceOptions = {},
): Promise<ProvenanceValidation> {
  switch (candidate.kind) {
    case "spec":
    case "plan":
    case "review":
    case "other":
      return validateArtifact(repositoryRoot, candidate);
    case "commit":
      return validateCommit(repositoryRoot, candidate, options);
    case "pull-request":
      return validatePullRequest(candidate, options);
    case "operator":
      return validateOperator(candidate);
    case "url":
      return validateUrl(candidate);
    default: {
      const unknown = (candidate as { kind?: string }).kind ?? "unknown";
      throw new QuirksError("PROTOCOL_VIOLATION", `Unsupported provenance candidate kind: ${unknown}`);
    }
  }
}
