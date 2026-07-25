import { QuirksError } from "../core/errors.js";
import { sha256 } from "../core/hash.js";
import { getRecipe, promptRecipeCatalog } from "../prompt/catalog.js";
import {
  assemblePromptContext,
  type CampaignPromptProjection,
  type NormalizedTaskProjection,
} from "../prompt/context.js";
import { renderPrompt } from "../prompt/render.js";
import { loadPlanOutline, type ImmutableSourceRef, type PlanOutline } from "./plan-outline.js";
import type { JudgmentTier } from "./types.js";
import type { PromptAction, PromptContextKind } from "../prompt/types.js";
import type { RunnerProfile } from "../runner/types.js";

/** Raw normalized-task record shape returned by a TaskSource `show`. */
export interface NormalizedTaskRecord {
  title?: string;
  status: string;
  dependsOn: readonly string[];
  sourceRefs?: readonly Record<string, unknown>[];
  acceptanceCriteria?: readonly string[];
  verification?: readonly string[];
  statusDetail?: null | { reason: string; unblockCondition: string };
  coordination?: null | { scope: string; campaignId: string; owner: string; claimedAt?: string };
  execution: { parallelismKeys?: readonly string[]; effort?: JudgmentTier; risk?: readonly string[] };
}

/** Bounded authoritative task facts shared by campaign briefs and UI prompts. */
export interface AuthoritativeTaskFacts {
  id: string;
  title: string;
  status: string;
  dependsOn: readonly string[];
  nativeRevision: string;
  sourceRefs: readonly Record<string, unknown>[];
  acceptanceCriteria: readonly string[];
  verification: readonly string[];
  effort: JudgmentTier;
  risk: readonly string[];
  statusDetail: null | { reason: string; unblockCondition: string };
  coordination: null | { campaignId: string };
}

export function taskFactsFromShow(
  taskId: string,
  data: NormalizedTaskRecord,
  nativeRevision: string,
): AuthoritativeTaskFacts {
  return {
    id: taskId,
    title: data.title ?? taskId,
    status: data.status,
    dependsOn: data.dependsOn,
    nativeRevision,
    sourceRefs: data.sourceRefs ?? [],
    acceptanceCriteria: data.acceptanceCriteria ?? [],
    verification: data.verification ?? [],
    effort: data.execution.effort ?? "standard",
    risk: data.execution.risk ?? [],
    statusDetail: data.statusDetail ?? null,
    coordination: data.coordination ? { campaignId: data.coordination.campaignId } : null,
  };
}

export function briefTaskProjection(facts: AuthoritativeTaskFacts): NormalizedTaskProjection {
  return {
    id: facts.id,
    title: facts.title,
    status: facts.status,
    dependsOn: facts.dependsOn,
    nativeRevision: facts.nativeRevision,
    acceptanceCriteria: facts.acceptanceCriteria,
    verification: facts.verification,
    effort: facts.effort,
    risk: facts.risk,
    ...(facts.statusDetail ? { blockedReason: facts.statusDetail.reason } : {}),
    ...(facts.statusDetail ? { unblockCondition: facts.statusDetail.unblockCondition } : {}),
  };
}

export function immutablePlanRefs(facts: AuthoritativeTaskFacts): ImmutableSourceRef[] {
  const refs: ImmutableSourceRef[] = [];
  for (const ref of facts.sourceRefs) {
    if (ref["kind"] !== "plan") continue;
    if (typeof ref["path"] !== "string" || typeof ref["commit"] !== "string") continue;
    refs.push({
      kind: "plan",
      path: ref["path"],
      commit: ref["commit"],
      ...(typeof ref["task"] === "number" ? { task: ref["task"] } : {}),
    });
  }
  return refs;
}

/** Resolve the immutable plan outline referenced by a task, merging one entry per numbered plan task. */
export async function resolveTaskPlanOutline(
  repositoryRoot: string,
  facts: AuthoritativeTaskFacts,
): Promise<PlanOutline | undefined> {
  const refs = immutablePlanRefs(facts);
  if (refs.length === 0) return undefined;
  const outlines: PlanOutline[] = [];
  for (const ref of refs) {
    outlines.push(await loadPlanOutline(repositoryRoot, [ref]));
  }
  const first = outlines[0]!;
  const merged = outlines
    .filter((outline) => outline.path === first.path && outline.commit === first.commit)
    .flatMap((outline) => outline.tasks);
  const seen = new Set<number>();
  return {
    path: first.path,
    commit: first.commit,
    tasks: merged.filter((entry) => (seen.has(entry.task) ? false : (seen.add(entry.task), true))),
  };
}

/**
 * Hash of the immutable prompt instruction surface frozen at preflight:
 * every recipe id/version in the reviewed catalog plus the configured
 * workflow skills. Any drift after approval requires re-preflight.
 */
export function computeInstructionsHash(skills: Readonly<Record<string, string>>): string {
  return sha256({
    recipes: promptRecipeCatalog.map((recipe) => ({ id: recipe.id, version: recipe.version })),
    skills,
  });
}

export interface BuildTaskBriefInput {
  role: "implementer" | "reviewer";
  repositoryId: string;
  campaign: CampaignPromptProjection;
  task: NormalizedTaskProjection;
  plan?: PlanOutline;
  git: { baseCommit: string; candidateCommit?: string };
  skills: Readonly<Record<string, string>>;
  profiles: readonly RunnerProfile[];
  implementerProfileId?: string;
}

function briefRecipeId(role: BuildTaskBriefInput["role"]): PromptAction {
  return role === "implementer" ? "continue-task" : "review-task-code";
}

function briefContextKind(role: BuildTaskBriefInput["role"]): PromptContextKind {
  return role === "implementer" ? "task" : "review";
}

/**
 * Build the authoritative role brief dispatched to a campaign worker. The
 * same prompt kernel renders contextual UI copy actions, so a copied prompt
 * and a dispatched worker receive identical authoritative bindings for the
 * same recipe. Reviewer briefs require the candidate commit and fail closed
 * without it; no role ever receives an ID-only brief.
 */
export async function buildTaskBrief(input: BuildTaskBriefInput): Promise<string> {
  if (input.role === "reviewer" && !input.git.candidateCommit) {
    throw new QuirksError(
      "PROTOCOL_VIOLATION",
      `Reviewer brief for ${input.task.id} requires a validated candidate commit`,
    );
  }
  // A candidate identical to the base is the same absence wearing a plausible
  // value: there is no diff to review, so the brief fails closed exactly as it
  // does for a missing candidate (QK-CTL-011).
  if (input.role === "reviewer" && input.git.candidateCommit === input.git.baseCommit) {
    throw new QuirksError(
      "PROTOCOL_VIOLATION",
      `Reviewer brief for ${input.task.id} has a candidate commit identical to the base; there is nothing to review`,
    );
  }
  const recipe = getRecipe(briefRecipeId(input.role));
  if (!recipe) {
    throw new QuirksError("PROTOCOL_VIOLATION", `No brief recipe is registered for role ${input.role}`);
  }
  const context = await assemblePromptContext({
    contextKind: briefContextKind(input.role),
    repositoryId: input.repositoryId,
    task: input.task,
    ...(input.plan ? { plan: input.plan } : {}),
    campaign: input.campaign,
    git: input.git,
    skills: input.skills,
    profiles: input.profiles,
    ...(input.implementerProfileId !== undefined ? { implementerProfileId: input.implementerProfileId } : {}),
  });
  // No result-envelope contract is appended. Demanding a rigid envelope from a
  // CLI that was never built to emit one is what QK-RUN-009 removed: the
  // managing agent derives the structure from what the runner actually says.
  return renderPrompt(recipe, context).prompt;
}
