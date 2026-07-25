import assert from "node:assert/strict";
import test from "node:test";
import { buildTaskBrief, computeInstructionsHash, type BuildTaskBriefInput } from "../../src/campaign/task-brief.js";
import type { RunnerProfile } from "../../src/runner/types.js";

const BASE_COMMIT = "a".repeat(40);
const CANDIDATE_COMMIT = "b".repeat(40);

function runnerProfile(profileId: string, runnerType: RunnerProfile["runnerType"], model: string): RunnerProfile {
  return {
    schemaVersion: 1,
    profileId,
    runnerType,
    executable: "bin/runner",
    accountAlias: "acct",
    quotaPoolId: "default",
    tier: "principal",
    model,
    effort: "standard",
    capabilities: [],
    wallClockMs: 3_600_000,
    redactionRules: [],
  };
}

function briefInput(overrides: Partial<BuildTaskBriefInput> = {}): BuildTaskBriefInput {
  return {
    role: "implementer",
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
      status: "ready",
      dependsOn: [],
      nativeRevision: `sha256:${"d".repeat(64)}`,
      acceptanceCriteria: ["Feature passes verification"],
      verification: ["pnpm check"],
      effort: "standard",
      risk: [],
    },
    git: { baseCommit: BASE_COMMIT },
    skills: { execute: "executing-tasks" },
    profiles: [
      runnerProfile("codex-implementer", "codex", "gpt-5.6-sol"),
      runnerProfile("claude-reviewer", "claude", "opus-4.8"),
    ],
    implementerProfileId: "codex-implementer",
    ...overrides,
  };
}

test("implementer brief is an executable role brief, never an ID-only stub", async () => {
  const brief = await buildTaskBrief(briefInput());
  assert.notEqual(brief.trim(), "# QK-1");
  assert.match(brief, /^Objective:/m);
  assert.match(brief, /QK-1/);
  assert.match(brief, /executing-tasks/);
  assert.match(brief, /Verification:/);
  assert.match(brief, /pnpm check/);
});

test("reviewer brief is distinct, read-only, and bound to the candidate commit", async () => {
  const implementer = await buildTaskBrief(briefInput());
  const reviewer = await buildTaskBrief(briefInput({
    role: "reviewer",
    task: {
      id: "QK-1",
      title: "Contract task",
      status: "claimed",
      dependsOn: [],
      nativeRevision: `sha256:${"d".repeat(64)}`,
      acceptanceCriteria: ["Feature passes verification"],
      verification: ["pnpm check"],
      effort: "standard",
      risk: [],
    },
    git: { baseCommit: BASE_COMMIT, candidateCommit: CANDIDATE_COMMIT },
  }));
  assert.notEqual(implementer, reviewer);
  assert.match(reviewer, /Do not modify code/);
  assert.match(reviewer, new RegExp(CANDIDATE_COMMIT));
  assert.match(reviewer, /executing-tasks/);
});

test("reviewer brief requires a candidate commit", async () => {
  await assert.rejects(
    () => buildTaskBrief(briefInput({ role: "reviewer" })),
    /candidate|commit/i,
  );
});

test("no brief states a result envelope contract, for any runner", async () => {
  // The contract was the source of the defects, and under --output-schema it
  // cost a reviewer its reasoning outright. Briefs describe the work; the
  // managing agent derives the structure (QK-RUN-009).
  const brief = await buildTaskBrief(briefInput());
  assert.doesNotMatch(brief, /Runner result contract:/);
  assert.doesNotMatch(brief, /result envelope/i);
});

test("instructions hash freezes recipe versions plus configured workflow skills", () => {
  const skills = { execute: "executing-tasks" };
  assert.equal(computeInstructionsHash(skills), computeInstructionsHash({ execute: "executing-tasks" }));
  assert.notEqual(computeInstructionsHash(skills), computeInstructionsHash({}));
  assert.match(computeInstructionsHash(skills), /^sha256:[0-9a-f]{64}$/);
});

/**
 * Defence in depth for QK-CTL-011: even if some future path derives a candidate
 * equal to the base, a reviewer brief describing an empty diff must never be
 * built. The builder already fails closed on a missing candidate; an identical
 * one is the same absence wearing a plausible value.
 */
test("reviewer brief refuses a candidate commit identical to the base", async () => {
  await assert.rejects(
    () => buildTaskBrief(briefInput({
      role: "reviewer",
      git: { baseCommit: BASE_COMMIT, candidateCommit: BASE_COMMIT },
    })),
    /candidate/i,
    "an empty diff is not reviewable",
  );
});
