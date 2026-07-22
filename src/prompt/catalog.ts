import type { PromptAction, PromptContext, PromptRecipe } from "./types.js";

function hasReviewCommits(context: PromptContext): boolean {
  return Boolean(context.git?.baseCommit && context.git.candidateCommit);
}

/**
 * Reviewed, versioned prompt recipe catalog. Changing rendered behavior
 * increments the recipe version and produces reviewable golden-test diffs.
 * Applicability is state-guarded: unsafe recipes are absent, never disabled.
 */
export const promptRecipeCatalog: readonly PromptRecipe[] = [
  {
    id: "review-campaign-plan",
    version: 1,
    label: "Copy plan review prompt",
    description: "Read-only review of a preflight proposal against its plan tasks, routing, budgets, and frozen envelope.",
    authority: "read-only",
    requiredBindings: ["campaign"],
    requiredSkills: ["running-agent-campaigns"],
    applicable: (context) =>
      context.campaign !== undefined &&
      (context.campaign.state === "preflight" || context.campaign.state === "awaiting_approval"),
  },
  {
    id: "start-approved-campaign",
    version: 1,
    label: "Copy start campaign prompt",
    description: "Operational brief that starts the exact approved campaign envelope without scope expansion.",
    authority: "state-changing",
    requiredBindings: ["campaign"],
    requiredSkills: ["running-agent-campaigns"],
    applicable: (context) =>
      context.campaign !== undefined &&
      context.campaign.approved &&
      context.campaign.state === "awaiting_approval",
  },
  {
    id: "continue-task",
    version: 1,
    label: "Copy continue task prompt",
    description: "Task-scoped brief bound to the exact plan task, current step, and verification commands.",
    authority: "state-changing",
    requiredBindings: ["task"],
    requiredSkills: ["executing-tasks"],
    applicable: (context) =>
      context.task !== undefined &&
      (context.task.status === "claimed" || context.task.status === "ready"),
  },
  {
    id: "unblock-task",
    version: 1,
    label: "Copy unblock task prompt",
    description: "Diagnosis-first brief for a blocked task, bound to its recorded reason and unblock condition.",
    authority: "state-changing",
    requiredBindings: ["task"],
    requiredSkills: ["executing-tasks"],
    applicable: (context) => context.task !== undefined && context.task.status === "blocked",
  },
  {
    id: "review-task-code",
    version: 1,
    label: "Copy review prompt",
    description: "Read-only review comparing validated base and candidate commits against the exact task and plan task.",
    authority: "read-only",
    requiredBindings: ["task", "commit"],
    requiredSkills: ["executing-tasks"],
    applicable: (context) => context.task !== undefined && hasReviewCommits(context),
  },
  {
    id: "adversarial-task-review",
    version: 1,
    label: "Copy adversarial review prompt",
    description: "Independent review by a different approved model family that challenges implementation and prior review conclusions.",
    authority: "read-only",
    requiredBindings: ["task", "commit"],
    requiredSkills: ["executing-tasks"],
    applicable: (context) => context.task !== undefined && hasReviewCommits(context),
  },
];

const catalogById = new Map<PromptAction, PromptRecipe>(promptRecipeCatalog.map((recipe) => [recipe.id, recipe]));

export function getRecipe(id: PromptAction): PromptRecipe | undefined {
  return catalogById.get(id);
}

/** Recipes valid for this context, in stable catalog order. */
export function getApplicableRecipes(context: PromptContext): readonly PromptRecipe[] {
  return promptRecipeCatalog.filter((recipe) => recipe.applicable(context));
}
