import type { PromptContext } from "../../../src/prompt/types.js";
import type { PromptReadPort, PromptReadRequest } from "../../../src/ui/ports/prompt-read.js";

export function reviewPromptContext(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    contextKind: "review",
    repositoryId: "repo-1",
    campaign: {
      campaignId: "C-1",
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
      effort: "standard",
      risk: [],
    },
    plan: {
      path: "docs/superpowers/plans/plan.md",
      commit: "a".repeat(40),
      tasks: [{ number: 1, title: "Do the work" }],
    },
    git: { baseCommit: "e".repeat(40), candidateCommit: "b".repeat(40) },
    skills: { execute: "executing-tasks" },
    implementer: {
      profileId: "codex-gpt",
      runnerKind: "codex",
      model: "gpt-5.6-sol",
      modelFamily: "gpt",
      tier: "high",
    },
    profiles: [
      { profileId: "codex-gpt", runnerKind: "codex", model: "gpt-5.6-sol", modelFamily: "gpt", tier: "high" },
      { profileId: "claude-opus", runnerKind: "claude", model: "opus-4.8", modelFamily: "claude", tier: "principal" },
    ],
    ...overrides,
  };
}

export function approvedCampaignPromptContext(): PromptContext {
  return reviewPromptContext({
    contextKind: "campaign",
    campaign: {
      campaignId: "C-approved",
      state: "awaiting_approval",
      approved: true,
      envelopeDigest: `sha256:${"c".repeat(64)}`,
    },
  });
}

export function awaitingApprovalPromptContext(): PromptContext {
  return reviewPromptContext({
    contextKind: "campaign",
    campaign: {
      campaignId: "C-1",
      state: "awaiting_approval",
      approved: false,
      envelopeDigest: `sha256:${"c".repeat(64)}`,
    },
  });
}

/**
 * Campaign context for a RUNNING campaign: no task/plan/git bindings exist at
 * the campaign scope, and no catalog recipe is state-valid while executing —
 * the honest projection is an explicit empty prompt set.
 */
export function runningCampaignPromptContext(): PromptContext {
  const context = reviewPromptContext({
    contextKind: "campaign",
    campaign: {
      campaignId: "C-running",
      state: "running",
      approved: true,
      envelopeDigest: `sha256:${"c".repeat(64)}`,
    },
  });
  delete context.task;
  delete context.plan;
  delete context.git;
  return context;
}

export function activeTaskPromptContext(taskId: string): PromptContext {
  return reviewPromptContext({
    contextKind: "task",
    task: {
      id: taskId,
      title: "Contract task",
      status: "ready",
      dependsOn: [],
      nativeRevision: `sha256:${"d".repeat(64)}`,
      acceptanceCriteria: ["Feature passes verification"],
      verification: ["pnpm check"],
      effort: "standard",
      risk: [],
    },
  });
}

export function fakePromptReadPort(): PromptReadPort {
  return {
    async getContext(request: PromptReadRequest): Promise<PromptContext> {
      if (request.contextKind === "review" && request.taskId === "QK-1") {
        return reviewPromptContext();
      }
      if (request.contextKind === "task" && request.taskId === "QK-1") {
        return activeTaskPromptContext("QK-1");
      }
      if (request.contextKind === "campaign" && request.campaignId === "C-1") {
        return awaitingApprovalPromptContext();
      }
      if (request.contextKind === "campaign" && request.campaignId === "C-approved") {
        return approvedCampaignPromptContext();
      }
      if (request.contextKind === "campaign" && request.campaignId === "C-running") {
        return runningCampaignPromptContext();
      }
      throw new Error(`No prompt context for ${request.contextKind}`);
    },
  };
}
