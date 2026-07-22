import { QuirksError } from "../../core/errors.js";
import { getApplicableRecipes } from "../../prompt/catalog.js";
import { renderPrompt } from "../../prompt/render.js";
import { validateSchema } from "../../schema/validate.js";
import type { PromptContext, RenderedPrompt, UiPromptSetV1 } from "../../prompt/types.js";

function contextState(context: PromptContext): string {
  if (context.contextKind === "campaign" || context.contextKind === "plan") {
    return context.campaign?.state ?? context.task?.status ?? "unknown";
  }
  return context.task?.status ?? context.campaign?.state ?? "unknown";
}

function recommendRecipeId(context: PromptContext, rendered: readonly RenderedPrompt[]): string {
  const available = new Set(rendered.map((recipe) => recipe.recipeId));
  const prefer = (id: string): string | undefined => (available.has(id) ? id : undefined);

  if (context.contextKind === "review") {
    const pick = prefer("review-task-code");
    if (pick) return pick;
  }
  if (context.campaign?.state === "awaiting_approval") {
    const pick = context.campaign.approved ? prefer("start-approved-campaign") : prefer("review-campaign-plan");
    if (pick) return pick;
  }
  if (context.campaign?.state === "preflight") {
    const pick = prefer("review-campaign-plan");
    if (pick) return pick;
  }
  if (context.task?.status === "blocked") {
    const pick = prefer("unblock-task");
    if (pick) return pick;
  }
  if (context.task?.status === "claimed" || context.task?.status === "ready") {
    const pick = prefer("continue-task");
    if (pick) return pick;
  }
  if (context.task?.status === "in_review") {
    const pick = prefer("review-task-code");
    if (pick) return pick;
  }
  return rendered[0]!.recipeId;
}

/**
 * Filter state-valid recipes, render each independently, and select the
 * recommended recipe by context state. A recipe whose required authority is
 * absent is dropped (unavailable, never disabled); a context with no
 * applicable, renderable recipe is a protocol error.
 */
export function buildPromptSet(context: PromptContext): UiPromptSetV1 {
  const applicable = getApplicableRecipes(context);
  const rendered: RenderedPrompt[] = [];
  for (const recipe of applicable) {
    try {
      rendered.push(renderPrompt(recipe, context));
    } catch (error) {
      if (error instanceof QuirksError) continue;
      throw error;
    }
  }
  if (rendered.length === 0) {
    throw new QuirksError(
      "PROTOCOL_VIOLATION",
      `No applicable prompt recipe for ${context.contextKind} context in state ${contextState(context)}`,
    );
  }

  const set: UiPromptSetV1 = {
    schemaVersion: 1,
    context: {
      kind: context.contextKind,
      campaignId: context.campaign?.campaignId ?? null,
      taskId: context.task?.id ?? null,
      state: contextState(context),
    },
    recommendedRecipeId: recommendRecipeId(context, rendered),
    recipes: rendered,
  };
  return validateSchema<UiPromptSetV1>("ui-prompt-set-v1", set);
}
