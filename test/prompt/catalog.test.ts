import assert from "node:assert/strict";
import test from "node:test";
import { getApplicableRecipes, getRecipe, promptRecipeCatalog } from "../../src/prompt/catalog.js";
import type { PromptContext } from "../../src/prompt/types.js";

export function reviewContext(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    contextKind: "review",
    repositoryId: "repo-1",
    campaign: {
      campaignId: "cmp-1",
      state: "running",
      approved: true,
      envelopeDigest: `sha256:${"c".repeat(64)}`,
    },
    task: {
      id: "QK-1",
      title: "Contract task",
      status: "in_review",
      dependsOn: [],
      nativeRevision: `sha256:${"d".repeat(64)}`,
      acceptanceCriteria: ["Feature passes verification"],
      verification: ["pnpm check"],
    },
    plan: {
      path: "docs/superpowers/plans/plan.md",
      commit: "a".repeat(40),
      tasks: [{ number: 1, title: "Do the work" }],
    },
    git: { baseCommit: "e".repeat(40), candidateCommit: "b".repeat(40) },
    skills: { "executing-tasks": "Follow approved execution workflow" },
    implementer: {
      profileId: "codex-gpt",
      runnerKind: "codex",
      model: "gpt-5.6-sol",
      modelFamily: "codex",
      tier: "high",
    },
    profiles: [
      { profileId: "codex-gpt", runnerKind: "codex", model: "gpt-5.6-sol", modelFamily: "codex", tier: "high" },
      { profileId: "claude-opus", runnerKind: "claude", model: "opus-4.8", modelFamily: "claude", tier: "principal" },
    ],
    ...overrides,
  };
}

test("catalog registers the five rollout recipe families with positive versions", () => {
  const ids = promptRecipeCatalog.map((recipe) => recipe.id);
  assert.deepEqual(ids, [
    "review-campaign-plan",
    "start-approved-campaign",
    "continue-task",
    "unblock-task",
    "review-task-code",
    "adversarial-task-review",
  ]);
  for (const recipe of promptRecipeCatalog) {
    assert.ok(Number.isInteger(recipe.version) && recipe.version >= 1, `${recipe.id} version`);
    assert.ok(recipe.label.length > 0);
    assert.ok(recipe.requiredSkills.length > 0, `${recipe.id} must bind required skills`);
  }
  assert.equal(getRecipe("review-task-code")?.id, "review-task-code");
});

test("start-approved-campaign is absent before recorded approval", () => {
  const unapproved = reviewContext({
    contextKind: "campaign",
    campaign: {
      campaignId: "cmp-1",
      state: "awaiting_approval",
      approved: false,
      envelopeDigest: `sha256:${"c".repeat(64)}`,
    },
  });
  assert.equal(
    getApplicableRecipes(unapproved).some((recipe) => recipe.id === "start-approved-campaign"),
    false,
  );

  const approved = reviewContext({
    contextKind: "campaign",
    campaign: {
      campaignId: "cmp-1",
      state: "awaiting_approval",
      approved: true,
      envelopeDigest: `sha256:${"c".repeat(64)}`,
    },
  });
  assert.equal(
    getApplicableRecipes(approved).some((recipe) => recipe.id === "start-approved-campaign"),
    true,
  );
});

test("review-task-code is absent without both base and candidate commits", () => {
  const missingCandidate = reviewContext({ git: { baseCommit: "e".repeat(40) } });
  assert.equal(
    getApplicableRecipes(missingCandidate).some((recipe) => recipe.id === "review-task-code"),
    false,
  );
  assert.equal(
    getApplicableRecipes(missingCandidate).some((recipe) => recipe.id === "adversarial-task-review"),
    false,
  );

  const missingGit = reviewContext();
  delete (missingGit as { git?: unknown }).git;
  assert.equal(
    getApplicableRecipes(missingGit).some((recipe) => recipe.id === "review-task-code"),
    false,
  );

  const complete = reviewContext();
  assert.equal(
    getApplicableRecipes(complete).some((recipe) => recipe.id === "review-task-code"),
    true,
  );
});

test("plan review applies while awaiting approval and never after", () => {
  const awaiting = reviewContext({
    contextKind: "campaign",
    campaign: {
      campaignId: "cmp-1",
      state: "awaiting_approval",
      approved: false,
      envelopeDigest: `sha256:${"c".repeat(64)}`,
    },
  });
  assert.equal(
    getApplicableRecipes(awaiting).some((recipe) => recipe.id === "review-campaign-plan"),
    true,
  );
  const running = reviewContext({ contextKind: "campaign" });
  assert.equal(
    getApplicableRecipes(running).some((recipe) => recipe.id === "review-campaign-plan"),
    false,
  );
});

test("continue and unblock recipes follow task state", () => {
  const claimed = reviewContext({
    contextKind: "task",
    task: {
      id: "QK-1",
      title: "Contract task",
      status: "claimed",
      dependsOn: [],
      nativeRevision: `sha256:${"d".repeat(64)}`,
      acceptanceCriteria: [],
      verification: [],
    },
  });
  const claimedIds = getApplicableRecipes(claimed).map((recipe) => recipe.id);
  assert.equal(claimedIds.includes("continue-task"), true);
  assert.equal(claimedIds.includes("unblock-task"), false);

  const blocked = reviewContext({
    contextKind: "task",
    task: {
      id: "QK-1",
      title: "Contract task",
      status: "blocked",
      dependsOn: [],
      nativeRevision: `sha256:${"d".repeat(64)}`,
      acceptanceCriteria: [],
      verification: [],
    },
  });
  const blockedIds = getApplicableRecipes(blocked).map((recipe) => recipe.id);
  assert.equal(blockedIds.includes("unblock-task"), true);
  assert.equal(blockedIds.includes("continue-task"), false);
});

test("state-changing recipes are marked and read-only recipes never claim authority", () => {
  for (const recipe of promptRecipeCatalog) {
    if (recipe.id === "start-approved-campaign" || recipe.id === "continue-task" || recipe.id === "unblock-task") {
      assert.equal(recipe.authority, "state-changing", recipe.id);
    } else {
      assert.equal(recipe.authority, "read-only", recipe.id);
    }
  }
});
