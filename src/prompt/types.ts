import type { CampaignStatus, JudgmentTier } from "../campaign/types.js";
import type { RunnerType } from "../campaign/routing.js";

/** Stable identifiers for reviewed, versioned prompt recipes. */
export type PromptAction =
  | "review-campaign-plan"
  | "start-approved-campaign"
  | "continue-campaign"
  | "recover-campaign"
  | "continue-task"
  | "unblock-task"
  | "review-task-code"
  | "adversarial-task-review"
  | "security-review"
  | "test-gap-review"
  | "landing-readiness-review";

export type PromptBindingKind = "campaign" | "task" | "plan-task" | "path" | "commit" | "skill";

export type PromptAuthority = "read-only" | "state-changing";

export type PromptContextKind = "campaign" | "task" | "plan" | "review";

/** Bounded campaign facts read through existing authority ports. */
export interface PromptCampaignContext {
  campaignId: string;
  state: CampaignStatus;
  /** True only when a durable digest-bound approval is recorded. */
  approved: boolean;
  envelopeDigest: string;
}

/** Bounded task facts from the normalized task projection. */
export interface PromptTaskContext {
  id: string;
  title: string;
  status: string;
  dependsOn: readonly string[];
  nativeRevision: string;
  acceptanceCriteria: readonly string[];
  verification: readonly string[];
  effort?: JudgmentTier;
  risk?: readonly string[];
  blockedReason?: string;
  unblockCondition?: string;
}

export interface PromptPlanTaskContext {
  number: number;
  title: string;
  currentStep?: string;
}

/** Immutable plan outline facts. */
export interface PromptPlanContext {
  path: string;
  commit: string;
  tasks: readonly PromptPlanTaskContext[];
}

export interface PromptGitContext {
  baseCommit: string;
  candidateCommit?: string;
}

/** Approved runner profile facts relevant to prompt targeting. */
export interface PromptProfileContext {
  profileId: string;
  runnerKind: RunnerType;
  model: string;
  /** Vendor model family used for independence checks (e.g. "claude", "codex"). */
  modelFamily: string;
  tier: JudgmentTier;
}

/**
 * Authoritative bounded context consumed by prompt recipes. Missing required
 * authority stays missing; it is never inferred or reconstructed.
 */
export interface PromptContext {
  contextKind: PromptContextKind;
  repositoryId: string;
  campaign?: PromptCampaignContext;
  task?: PromptTaskContext;
  plan?: PromptPlanContext;
  git?: PromptGitContext;
  /** Canonical skill name to purpose statement, from effective workflow policy. */
  skills: Readonly<Record<string, string>>;
  implementer?: PromptProfileContext;
  profiles: readonly PromptProfileContext[];
}

/** A reviewed production recipe definition. Not user-authored text. */
export interface PromptRecipe {
  id: PromptAction;
  version: number;
  label: string;
  description: string;
  authority: PromptAuthority;
  requiredBindings: readonly PromptBindingKind[];
  requiredSkills: readonly string[];
  applicable(context: PromptContext): boolean;
}

export interface RenderedPromptBinding {
  kind: PromptBindingKind;
  label: string;
  value: string;
}

export interface RenderedPromptTarget {
  profileId: string | null;
  runnerKind: string | null;
  model: string | null;
  independentFromProfileId: string | null;
}

/** Deterministic rendered projection of one recipe for one context. */
export interface RenderedPrompt {
  recipeId: string;
  recipeVersion: number;
  label: string;
  description: string;
  prompt: string;
  target: RenderedPromptTarget;
  bindings: readonly RenderedPromptBinding[];
  warnings: readonly string[];
  authority: PromptAuthority;
}

export interface UiPromptSetContextV1 {
  kind: PromptContextKind;
  campaignId: string | null;
  taskId: string | null;
  state: string;
}

/** Wire projection returned by the loopback prompt API. */
export interface UiPromptSetV1 {
  schemaVersion: 1;
  context: UiPromptSetContextV1;
  recommendedRecipeId: string;
  recipes: RenderedPrompt[];
}
