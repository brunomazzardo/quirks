import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { computeEnvelopeDigest, stripDigest } from "../../../src/campaign/envelope.js";
import { CampaignStore } from "../../../src/campaign/store.js";
import type { ProgressBinding } from "../../../src/campaign/types.js";
import { initializeProgressMailbox, observeRunnerProgress, updateRunnerProgress } from "../../../src/runner/progress.js";
import { campaignEnvelope } from "../../campaign/support.js";

export async function createProgressStoreFixture(input: { jobId: string; allowedPlanTasks: readonly number[] }) {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-progress-"));
  const incomplete = campaignEnvelope({ campaignId: "cmp-progress", taskIds: ["QK-1"] });
  const envelope = { ...incomplete, digest: computeEnvelopeDigest(stripDigest(incomplete)) };
  const store = await CampaignStore.create({
    stateDir,
    repositoryId: envelope.repositoryId,
    campaignId: envelope.campaignId,
    envelope,
  });
  const startedAt = "2026-07-21T18:00:00.000Z";
  const binding: ProgressBinding = {
    schemaVersion: 1,
    repositoryId: envelope.repositoryId,
    campaignId: envelope.campaignId,
    taskId: "QK-1",
    jobId: input.jobId,
    attempt: 1,
    planPath: "docs/superpowers/plans/2026-07-21-quirks-campaign-control-plane.md",
    planCommit: "a".repeat(40),
    allowedPlanTasks: [...input.allowedPlanTasks],
  };
  const contextPath = await initializeProgressMailbox(store, binding, startedAt);
  return {
    store,
    binding,
    startedAt,
    contextPath,
    allStepIds: ["task-14/step-1", "task-14/step-2", "task-14/step-3", "task-14/step-4", "task-14/step-5"],
    report: async (update: Parameters<typeof updateRunnerProgress>[1]) => {
      if (update.status === "reported_complete") {
        await updateRunnerProgress(contextPath, {
          status: "running",
          stage: "implement",
          planTask: update.planTask,
          step: 1,
          completedStepIds: [],
          tddPhase: "green",
        }, "2026-07-21T18:00:02.000Z");
      }
      await updateRunnerProgress(contextPath, update, "2026-07-21T18:00:05.000Z");
      await observeRunnerProgress(store, binding.jobId, "2026-07-21T18:00:05.100Z");
    },
    taskSource: {
      show: async (taskId: string) => ({ taskId, status: "claimed" }),
    },
  };
}
