import { QuirksError } from "../core/errors.js";
import { sha256 } from "../core/hash.js";
import { getRecipe, promptRecipeCatalog } from "../prompt/catalog.js";
import {
  assemblePromptContext,
  type CampaignPromptProjection,
  type NormalizedTaskProjection,
} from "../prompt/context.js";
import { renderPrompt } from "../prompt/render.js";
import type { PlanOutline } from "./plan-outline.js";
import type { PromptAction, PromptContextKind } from "../prompt/types.js";
import type { RunnerProfile } from "../runner/types.js";

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
  return renderPrompt(recipe, context).prompt;
}
