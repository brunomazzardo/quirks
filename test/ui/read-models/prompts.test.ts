import assert from "node:assert/strict";
import test from "node:test";
import { buildPromptSet } from "../../../src/ui/read-models/prompts.js";
import { validateSchema } from "../../../src/schema/validate.js";
import { approvedCampaignPromptContext, reviewPromptContext } from "../support/fake-prompts.js";

test("review context recommends code review and exposes state-valid alternatives", () => {
  const set = buildPromptSet(reviewPromptContext());
  assert.equal(set.schemaVersion, 1);
  assert.equal(set.recommendedRecipeId, "review-task-code");
  const ids = set.recipes.map((recipe) => recipe.recipeId);
  assert.ok(ids.includes("review-task-code"));
  assert.ok(ids.includes("adversarial-task-review"));
  assert.equal(ids.includes("start-approved-campaign"), false);
  assert.deepEqual(validateSchema("ui-prompt-set-v1", set), set);
  assert.equal(set.context.kind, "review");
  assert.equal(set.context.taskId, "QK-1");
  assert.equal(set.context.campaignId, "C-1");
});

test("approved not-started campaign recommends start and never offers it unapproved", () => {
  const approved = buildPromptSet(approvedCampaignPromptContext());
  assert.equal(approved.recommendedRecipeId, "start-approved-campaign");

  const unapproved = buildPromptSet(reviewPromptContext({
    contextKind: "campaign",
    campaign: {
      campaignId: "C-2",
      state: "awaiting_approval",
      approved: false,
      envelopeDigest: `sha256:${"c".repeat(64)}`,
    },
  }));
  assert.equal(unapproved.recommendedRecipeId, "review-campaign-plan");
  assert.equal(
    unapproved.recipes.some((recipe) => recipe.recipeId === "start-approved-campaign"),
    false,
  );
});

test("blocked task recommends unblock and claimed task recommends continue", () => {
  const blocked = buildPromptSet(reviewPromptContext({
    contextKind: "task",
    task: {
      id: "QK-9",
      title: "Blocked task",
      status: "blocked",
      dependsOn: [],
      nativeRevision: `sha256:${"d".repeat(64)}`,
      acceptanceCriteria: [],
      verification: [],
      blockedReason: "Dependency broke",
      unblockCondition: "Dependency fixed",
    },
  }));
  assert.equal(blocked.recommendedRecipeId, "unblock-task");

  const claimed = buildPromptSet(reviewPromptContext({
    contextKind: "task",
    task: {
      id: "QK-9",
      title: "Active task",
      status: "claimed",
      dependsOn: [],
      nativeRevision: `sha256:${"d".repeat(64)}`,
      acceptanceCriteria: [],
      verification: [],
    },
  }));
  assert.equal(claimed.recommendedRecipeId, "continue-task");
});

test("missing optional authority surfaces as visible warnings, not fabricated detail", () => {
  const context = reviewPromptContext();
  delete context.implementer;
  const set = buildPromptSet(context);
  const adversarial = set.recipes.find((recipe) => recipe.recipeId === "adversarial-task-review");
  assert.ok(adversarial, "adversarial recipe stays available");
  assert.equal(
    adversarial.warnings.some((warning) => warning.includes("independence-unavailable")),
    true,
  );
  assert.equal(adversarial.target.profileId, null);
});

test("projection never contains credential-shaped fields", () => {
  const serialized = JSON.stringify(buildPromptSet(reviewPromptContext()));
  assert.equal(serialized.includes("approvalToken"), false);
  assert.equal(serialized.includes("viewerToken"), false);
  assert.equal(serialized.includes("Bearer "), false);
});

test("a context with no applicable recipes is a protocol error", () => {
  const context = reviewPromptContext({
    contextKind: "campaign",
    campaign: {
      campaignId: "C-3",
      state: "complete",
      approved: true,
      envelopeDigest: `sha256:${"c".repeat(64)}`,
    },
  });
  delete context.task;
  delete context.git;
  assert.throws(() => buildPromptSet(context), /applicable/i);
});
