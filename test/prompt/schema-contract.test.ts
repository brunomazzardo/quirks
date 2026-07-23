import assert from "node:assert/strict";
import test from "node:test";
import { validateSchema } from "../../src/schema/validate.js";
import type { UiPromptSetV1 } from "../../src/prompt/types.js";

export function promptSetFixture(): UiPromptSetV1 {
  return {
    schemaVersion: 1,
    context: {
      kind: "review",
      campaignId: "cmp-1",
      taskId: "QK-1",
      state: "in_review",
    },
    recommendedRecipeId: "review-task-code",
    recipes: [
      {
        recipeId: "review-task-code",
        recipeVersion: 1,
        label: "Copy review prompt",
        description: "Read-only review comparing base and candidate commits against the exact task.",
        prompt: "Objective: review task QK-1.",
        target: {
          profileId: "claude-opus",
          runnerKind: "claude",
          model: "opus-4.8",
          independentFromProfileId: null,
        },
        bindings: [
          { kind: "task", label: "Task", value: "QK-1" },
          { kind: "commit", label: "Candidate commit", value: "b".repeat(40) },
          { kind: "skill", label: "Required skill", value: "executing-tasks" },
        ],
        warnings: [],
        authority: "read-only",
      },
    ],
  };
}

test("accepts a bounded prompt set and rejects credentials and unknown fields", () => {
  const valid = promptSetFixture();
  assert.deepEqual(validateSchema("ui-prompt-set-v1", valid), valid);
  assert.throws(() => validateSchema("ui-prompt-set-v1", { ...valid, approvalToken: "secret" }));
  assert.throws(() => validateSchema("ui-prompt-set-v1", { ...valid, surprise: true }));
});

test("rejects unknown fields nested inside recipes, targets, and bindings", () => {
  const valid = promptSetFixture();
  const extraRecipeField = structuredClone(valid) as unknown as { recipes: Record<string, unknown>[] };
  extraRecipeField.recipes[0]!["viewerToken"] = "tok";
  assert.throws(() => validateSchema("ui-prompt-set-v1", extraRecipeField));

  const extraTargetField = structuredClone(valid) as unknown as { recipes: { target: Record<string, unknown> }[] };
  extraTargetField.recipes[0]!.target["cookie"] = "session=1";
  assert.throws(() => validateSchema("ui-prompt-set-v1", extraTargetField));

  const extraBindingField = structuredClone(valid) as unknown as { recipes: { bindings: Record<string, unknown>[] }[] };
  extraBindingField.recipes[0]!.bindings[0]!["secret"] = "x";
  assert.throws(() => validateSchema("ui-prompt-set-v1", extraBindingField));
});

test("bounds prompt text, warnings, and binding values", () => {
  const valid = promptSetFixture();
  const oversizedPrompt = structuredClone(valid);
  oversizedPrompt.recipes[0]!.prompt = "x".repeat(20_000);
  assert.throws(() => validateSchema("ui-prompt-set-v1", oversizedPrompt));

  const oversizedBinding = structuredClone(valid);
  oversizedBinding.recipes[0]!.bindings[0]!.value = "y".repeat(2_000);
  assert.throws(() => validateSchema("ui-prompt-set-v1", oversizedBinding));

  const badBindingKind = structuredClone(valid) as unknown as { recipes: { bindings: { kind: string }[] }[] };
  badBindingKind.recipes[0]!.bindings[0]!.kind = "credential";
  assert.throws(() => validateSchema("ui-prompt-set-v1", badBindingKind));

  const badAuthority = structuredClone(valid) as unknown as { recipes: { authority: string }[] };
  badAuthority.recipes[0]!.authority = "root";
  assert.throws(() => validateSchema("ui-prompt-set-v1", badAuthority));
});

test("allows an explicit empty recipe set with a null recommendation, keeping the recommendedRecipeId key required", () => {
  const valid = promptSetFixture();
  // A context with no state-valid recipe (e.g. a RUNNING campaign) projects an
  // explicit empty set rather than erroring — empty recipes plus a null
  // recommendation is valid.
  assert.doesNotThrow(() =>
    validateSchema("ui-prompt-set-v1", { ...valid, recipes: [], recommendedRecipeId: null }),
  );
  // recommendedRecipeId stays a required (but nullable) key, so dropping it
  // entirely still fails closed.
  const { recommendedRecipeId: _dropped, ...withoutRecommendation } = valid;
  assert.throws(() => validateSchema("ui-prompt-set-v1", withoutRecommendation));
});
