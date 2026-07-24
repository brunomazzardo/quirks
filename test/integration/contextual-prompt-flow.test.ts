import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { consumeApprovalToken, createApprovalChallenge } from "../../src/campaign/approval.js";
import { finalizeEnvelope, stripDigest } from "../../src/campaign/envelope.js";
import { runPreflight } from "../../src/campaign/preflight.js";
import { CampaignStore } from "../../src/campaign/store.js";
import { CampaignSupervisor, type CampaignSupervisorContext } from "../../src/campaign/supervisor.js";
import { deriveModelFamily } from "../../src/prompt/model-selection.js";
import { SyncOutbox } from "../../src/sync/outbox.js";
import { createTaskSource } from "../../src/task-source/factory.js";
import { createPromptReadPort } from "../../src/ui/ports/prompt-read.js";
import { buildPromptSet } from "../../src/ui/read-models/prompts.js";
import type { RunnerProfile } from "../../src/runner/types.js";
import { FakeRunnerPort } from "../campaign/support/fake-runner-port.js";
import { FakeWorktreePort } from "../campaign/support/fake-worktree.js";
import {
  createContextualFixture,
  FEATURE_TASK_ID,
  materializeContextualPromptFeature,
  PLAN_TASK_NUMBERS,
} from "./support/contextual-fixture.js";

const CANDIDATE_COMMIT = "f".repeat(40);

function profile(profileId: string, runnerType: RunnerProfile["runnerType"], model: string): RunnerProfile {
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

const IMPLEMENTER = profile("codex-implementer", "codex", "gpt-5.6-sol");
const REVIEWER = profile("claude-reviewer", "claude", "opus-4.8");

test("one planned feature becomes one task and one consistent set of action briefs", async () => {
  const fixture = await createContextualFixture();
  const runner = new FakeRunnerPort();
  let supervisorContext: (CampaignSupervisorContext & { dispose(): Promise<void> }) | undefined;
  try {
    const task = await materializeContextualPromptFeature(fixture);
    assert.equal(task.id, FEATURE_TASK_ID);
    assert.deepEqual(
      task.sourceRefs.filter((ref) => ref.kind === "plan").map((ref) => ref.task),
      [...PLAN_TASK_NUMBERS],
    );

    const preflight = await runPreflight({
      repositoryRoot: fixture.root,
      selectedTaskIds: [FEATURE_TASK_ID],
      externalRoutingEnabled: false,
    });
    assert.equal(preflight.blockers.length, 0, preflight.blockers.join("; "));

    const envelope = finalizeEnvelope({
      ...stripDigest(preflight.envelope),
      routing: {
        [FEATURE_TASK_ID]: {
          primary: { profileId: IMPLEMENTER.profileId, tier: "standard", effort: "standard" },
          fallbacks: [{ profileId: REVIEWER.profileId, tier: "principal", effort: "standard" }],
        },
      },
    });

    const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-flow-state-"));
    const lockDir = await mkdtemp(path.join(os.tmpdir(), "quirks-flow-lock-"));
    const store = await CampaignStore.create({
      stateDir,
      repositoryId: envelope.repositoryId,
      campaignId: envelope.campaignId,
      envelope,
    });

    const challenge = createApprovalChallenge({
      campaignId: envelope.campaignId,
      digest: envelope.digest,
      ttlMs: 60_000,
    });
    await consumeApprovalToken({
      store,
      token: challenge.token,
      campaignId: envelope.campaignId,
      digest: envelope.digest,
      operator: { kind: "configured-profile", id: "operator@test" },
    });

    const worktree = new FakeWorktreePort();
    worktree.seed(FEATURE_TASK_ID, {
      path: `/tmp/quirks-flow/${FEATURE_TASK_ID}`,
      branch: `quirks/task/${FEATURE_TASK_ID}`,
      modifiedFiles: [],
      commit: CANDIDATE_COMMIT,
    });
    const source = await createTaskSource(fixture.context);
    supervisorContext = {
      store,
      source,
      outbox: SyncOutbox.open(store.syncOutboxFile),
      runner,
      worktree,
      lockPath: path.join(lockDir, "repository.lock"),
      repositoryRoot: fixture.root,
      profileIndex: new Map([
        [IMPLEMENTER.profileId, IMPLEMENTER],
        [REVIEWER.profileId, REVIEWER],
      ]),
      workflowSkills: fixture.context.config.workflowPolicy.skills,
      dispose: async () => {
        await source.dispose?.();
      },
    };

    const supervisor = await CampaignSupervisor.open(supervisorContext);
    await supervisor.startApproved();
    await supervisor.stop();

    const implementerDispatch = runner.dispatches.find((dispatch) => dispatch.role === "implementer");
    const reviewerDispatch = runner.dispatches.find((dispatch) => dispatch.role === "reviewer");
    assert.ok(implementerDispatch && reviewerDispatch, "both roles must be dispatched");
    assert.notEqual(implementerDispatch.briefPath, reviewerDispatch.briefPath);

    const implementerBrief = await readFile(implementerDispatch.briefPath, "utf8");
    const reviewerBrief = await readFile(reviewerDispatch.briefPath, "utf8");
    assert.notEqual(implementerBrief, reviewerBrief, "implementer and reviewer briefs are distinct");
    assert.notEqual(implementerBrief.trim(), `# ${FEATURE_TASK_ID}`, "ID-only briefs are prohibited");
    assert.match(implementerBrief, /executing-tasks/);
    assert.match(reviewerBrief, /Do not modify code/);
    assert.match(reviewerBrief, new RegExp(CANDIDATE_COMMIT));
    assert.match(reviewerBrief, /plan tasks 1, 2, 3, 4, 5, 6, 7, 8/);

    assert.equal(implementerDispatch.route.profileId, IMPLEMENTER.profileId);
    assert.equal(reviewerDispatch.route.profileId, REVIEWER.profileId);
    assert.notEqual(
      deriveModelFamily(IMPLEMENTER.model),
      deriveModelFamily(REVIEWER.model),
      "reviewer uses a different approved model family",
    );

    const promptPort = createPromptReadPort({
      repositoryId: envelope.repositoryId,
      repositoryRoot: fixture.root,
      source,
      skills: fixture.context.config.workflowPolicy.skills,
      profiles: [IMPLEMENTER, REVIEWER],
      campaign: async () => ({
        campaignId: envelope.campaignId,
        state: "running",
        approved: true,
        envelopeDigest: envelope.digest,
        baseCommit: envelope.git.baseCommit,
        implementerProfileId: IMPLEMENTER.profileId,
      }),
      candidateCommit: async () => CANDIDATE_COMMIT,
    });
    const context = await promptPort.getContext({ contextKind: "review", taskId: FEATURE_TASK_ID });
    const promptSet = buildPromptSet(context);
    const uiReview = promptSet.recipes.find((recipe) => recipe.recipeId === "review-task-code");
    assert.ok(uiReview, "review recipe must be applicable");
    // The dispatched brief is the copied prompt plus the job-bound result
    // contract, which a UI copy legitimately cannot carry: it has no dispatched
    // job and so no job-unique envelope path. The authoritative kernel — every
    // binding a reviewer acts on — must still be identical.
    assert.ok(
      reviewerBrief.startsWith(uiReview.prompt),
      "the copied UI review prompt and the dispatched reviewer brief share one authoritative kernel",
    );
    const addendum = reviewerBrief.slice(uiReview.prompt.length).trim();
    assert.ok(
      addendum === "" || addendum.startsWith("Runner result contract:"),
      `dispatched brief may only append the job-bound result contract, got: ${addendum.slice(0, 120)}`,
    );
  } finally {
    await supervisorContext?.dispose();
    await fixture.dispose();
  }
});

test("missing prompt authority fails closed instead of dispatching a generic brief", async () => {
  const fixture = await createContextualFixture();
  try {
    await materializeContextualPromptFeature(fixture);
    const port = createPromptReadPort({
      repositoryId: fixture.context.repositoryId,
      repositoryRoot: fixture.root,
      source: fixture.source,
      skills: fixture.context.config.workflowPolicy.skills,
      profiles: [],
    });
    await assert.rejects(
      () => port.getContext({ contextKind: "campaign", campaignId: "cmp-unknown" }),
      /campaign/i,
    );
    await assert.rejects(
      () => port.getContext({ contextKind: "task", taskId: "QK-MISSING" }),
      /QK-MISSING/,
    );
  } finally {
    await fixture.dispose();
  }
});
