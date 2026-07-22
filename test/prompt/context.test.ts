import assert from "node:assert/strict";
import test from "node:test";
import { assemblePromptContext, type AssemblePromptContextInput } from "../../src/prompt/context.js";
import type { RunnerProfile } from "../../src/runner/types.js";

function runnerProfile(profileId: string, runnerType: RunnerProfile["runnerType"], model: string): RunnerProfile {
  return {
    schemaVersion: 1,
    profileId,
    runnerType,
    executable: "bin/runner",
    accountAlias: "acct",
    quotaPoolId: "default",
    tier: "high",
    model,
    effort: "standard",
    capabilities: [],
    wallClockMs: 3_600_000,
    redactionRules: [],
  };
}

function baseInput(overrides: Partial<AssemblePromptContextInput> = {}): AssemblePromptContextInput {
  return {
    contextKind: "review",
    repositoryId: "repo-1",
    task: {
      id: "QK-1",
      title: "Contract task",
      status: "in_review",
      dependsOn: ["QK-0"],
      nativeRevision: `sha256:${"d".repeat(64)}`,
      acceptanceCriteria: ["Feature passes verification"],
      verification: ["pnpm check"],
    },
    plan: {
      path: "docs/superpowers/plans/plan.md",
      commit: "a".repeat(40),
      tasks: [{ task: 1, label: "Do the work", steps: [] }],
    },
    campaign: {
      campaignId: "cmp-1",
      state: "running",
      approved: true,
      envelopeDigest: `sha256:${"c".repeat(64)}`,
    },
    git: { baseCommit: "e".repeat(40), candidateCommit: "b".repeat(40) },
    skills: { "executing-tasks": "Follow approved execution workflow" },
    profiles: [
      runnerProfile("codex-gpt", "codex", "gpt-5.6-sol"),
      runnerProfile("claude-opus", "claude", "opus-4.8"),
    ],
    implementerProfileId: "codex-gpt",
    ...overrides,
  };
}

test("assembles a bounded context with derived model families", async () => {
  const context = await assemblePromptContext(baseInput());
  assert.equal(context.contextKind, "review");
  assert.equal(context.repositoryId, "repo-1");
  assert.equal(context.task?.id, "QK-1");
  assert.equal(context.campaign?.approved, true);
  assert.deepEqual(context.plan?.tasks, [{ number: 1, title: "Do the work" }]);
  assert.equal(context.git?.candidateCommit, "b".repeat(40));
  assert.equal(context.implementer?.profileId, "codex-gpt");
  assert.equal(context.implementer?.modelFamily, "gpt");
  assert.deepEqual(context.profiles.map((profile) => profile.modelFamily), ["gpt", "opus"]);
});

test("missing authority stays absent instead of being inferred", async () => {
  const input = baseInput({ contextKind: "task" });
  delete input.campaign;
  delete input.git;
  delete input.implementerProfileId;
  const context = await assemblePromptContext(input);
  assert.equal(context.campaign, undefined);
  assert.equal(context.git, undefined);
  assert.equal(context.implementer, undefined);
  assert.equal(context.task?.id, "QK-1");
});

test("rejects abbreviated, uppercase, or malformed commit SHAs", async () => {
  await assert.rejects(
    () => assemblePromptContext(baseInput({ git: { baseCommit: "abc123" } })),
    /SHA|commit/i,
  );
  await assert.rejects(
    () => assemblePromptContext(baseInput({ git: { baseCommit: "E".repeat(40) } })),
    /SHA|commit/i,
  );
  await assert.rejects(
    () => assemblePromptContext(baseInput({
      plan: { path: "docs/plan.md", commit: "xyz", tasks: [] },
    })),
    /SHA|commit/i,
  );
});

test("rejects absolute and traversal plan paths", async () => {
  await assert.rejects(
    () => assemblePromptContext(baseInput({
      plan: { path: "/etc/passwd", commit: "a".repeat(40), tasks: [] },
    })),
    /path/i,
  );
  await assert.rejects(
    () => assemblePromptContext(baseInput({
      plan: { path: "../../secrets.md", commit: "a".repeat(40), tasks: [] },
    })),
    /path/i,
  );
});

test("keeps acceptance and verification summaries compact", async () => {
  const context = await assemblePromptContext(baseInput({
    task: {
      id: "QK-1",
      title: "T",
      status: "ready",
      dependsOn: [],
      nativeRevision: `sha256:${"d".repeat(64)}`,
      acceptanceCriteria: Array.from({ length: 40 }, (_, index) => `criterion ${index} ${"x".repeat(600)}`),
      verification: Array.from({ length: 40 }, (_, index) => `command ${index}`),
    },
  }));
  assert.ok(context.task!.acceptanceCriteria.length <= 8, "acceptance criteria must be bounded");
  assert.ok(context.task!.verification.length <= 8, "verification summaries must be bounded");
  for (const criterion of context.task!.acceptanceCriteria) {
    assert.ok(criterion.length <= 256, "criterion text must be bounded");
  }
});

test("rejects an implementer profile id that is not among approved profiles", async () => {
  await assert.rejects(
    () => assemblePromptContext(baseInput({ implementerProfileId: "ghost-profile" })),
    /implementer/i,
  );
});
