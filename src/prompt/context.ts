import { QuirksError } from "../core/errors.js";
import { assertRepositoryRelativePath } from "../core/repository-path.js";
import type { PlanOutline } from "../campaign/plan-outline.js";
import type { RunnerProfile } from "../runner/types.js";
import { deriveModelFamily } from "./model-selection.js";
import type {
  PromptCampaignContext,
  PromptContext,
  PromptContextKind,
  PromptGitContext,
  PromptProfileContext,
  PromptTaskContext,
} from "./types.js";

const FULL_LOWERCASE_SHA = /^[0-9a-f]{40}$/;
const MAX_SUMMARY_ITEMS = 8;
const MAX_SUMMARY_CHARS = 256;

/** Bounded normalized-task facts consumed by prompt assembly. */
export interface NormalizedTaskProjection {
  id: string;
  title: string;
  status: string;
  dependsOn: readonly string[];
  nativeRevision: string;
  acceptanceCriteria: readonly string[];
  verification: readonly string[];
}

/** Bounded campaign facts consumed by prompt assembly. */
export interface CampaignPromptProjection extends PromptCampaignContext {}

export interface AssemblePromptContextInput {
  contextKind: PromptContextKind;
  repositoryId: string;
  task?: NormalizedTaskProjection;
  plan?: PlanOutline;
  campaign?: CampaignPromptProjection;
  git?: { baseCommit: string; candidateCommit?: string };
  skills: Readonly<Record<string, string>>;
  profiles: readonly RunnerProfile[];
  implementerProfileId?: string;
  verificationSummary?: readonly string[];
}

function assertFullSha(value: string, label: string): string {
  if (!FULL_LOWERCASE_SHA.test(value)) {
    throw new QuirksError(
      "PROTOCOL_VIOLATION",
      `${label} must be a full lowercase commit SHA: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function compactSummaries(entries: readonly string[]): string[] {
  return entries.slice(0, MAX_SUMMARY_ITEMS).map((entry) => entry.slice(0, MAX_SUMMARY_CHARS));
}

function toTaskContext(task: NormalizedTaskProjection): PromptTaskContext {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    dependsOn: [...task.dependsOn],
    nativeRevision: task.nativeRevision,
    acceptanceCriteria: compactSummaries(task.acceptanceCriteria),
    verification: compactSummaries(task.verification),
  };
}

function toProfileContext(profile: RunnerProfile): PromptProfileContext {
  return {
    profileId: profile.profileId,
    runnerKind: profile.runnerType,
    model: profile.model,
    modelFamily: deriveModelFamily(profile.model),
    tier: profile.tier,
  };
}

function toGitContext(git: NonNullable<AssemblePromptContextInput["git"]>): PromptGitContext {
  const context: PromptGitContext = { baseCommit: assertFullSha(git.baseCommit, "Base commit") };
  if (git.candidateCommit !== undefined) {
    context.candidateCommit = assertFullSha(git.candidateCommit, "Candidate commit");
  }
  return context;
}

/**
 * Assemble the bounded authoritative context consumed by prompt recipes.
 * Reads only projections handed in through existing authority ports; it does
 * not open canonical files. Missing authority stays absent — it is never
 * inferred — and malformed paths or SHAs fail closed.
 */
export async function assemblePromptContext(input: AssemblePromptContextInput): Promise<PromptContext> {
  const context: PromptContext = {
    contextKind: input.contextKind,
    repositoryId: input.repositoryId,
    skills: { ...input.skills },
    profiles: input.profiles.map(toProfileContext),
  };

  if (input.task) context.task = toTaskContext(input.task);

  if (input.plan) {
    try {
      assertRepositoryRelativePath(input.plan.path);
    } catch {
      throw new QuirksError(
        "PROTOCOL_VIOLATION",
        `Plan path must be repository-relative: ${JSON.stringify(input.plan.path)}`,
      );
    }
    assertFullSha(input.plan.commit, "Plan commit");
    context.plan = {
      path: input.plan.path,
      commit: input.plan.commit,
      tasks: input.plan.tasks.map((task) => ({ number: task.task, title: task.label })),
    };
  }

  if (input.campaign) {
    context.campaign = {
      campaignId: input.campaign.campaignId,
      state: input.campaign.state,
      approved: input.campaign.approved,
      envelopeDigest: input.campaign.envelopeDigest,
    };
  }

  if (input.git) context.git = toGitContext(input.git);

  if (input.implementerProfileId !== undefined) {
    const implementer = context.profiles.find((profile) => profile.profileId === input.implementerProfileId);
    if (!implementer) {
      throw new QuirksError(
        "PROTOCOL_VIOLATION",
        `Implementer profile ${input.implementerProfileId} is not among approved profiles`,
      );
    }
    context.implementer = implementer;
  }

  if (input.verificationSummary) {
    context.verificationSummary = compactSummaries(input.verificationSummary);
  }

  return context;
}
