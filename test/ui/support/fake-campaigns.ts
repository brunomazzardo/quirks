import type { CampaignReadPort, UiCampaignDetail, UiCampaignSummaryItem } from "../../../src/ui/ports/campaign-read.js";
import { buildPlanProgressProjection } from "../../../src/ui/read-models/plan-progress.js";
import { fixtureWithReportedCompletion } from "../../../src/ui/api/plan-progress.js";

const SUMMARIES: UiCampaignSummaryItem[] = [
  {
    campaignId: "C-1",
    repositoryId: "sha256:repo-1",
    state: "running",
    taskCount: 2,
    startedAt: "2026-07-21T12:00:00.000Z",
  },
  {
    campaignId: "C-0",
    repositoryId: "sha256:repo-1",
    state: "complete",
    taskCount: 3,
    startedAt: "2026-07-20T09:00:00.000Z",
    finishedAt: "2026-07-20T15:00:00.000Z",
    spend: { "cursor:composer-2.5": 1200 },
    outcome: "Landed via PR #41",
  },
];

const DETAILS: Record<string, UiCampaignDetail> = {
  "C-1": {
    campaignId: "C-1",
    repositoryId: "sha256:repo-1",
    state: "running",
    taskCount: 2,
    startedAt: "2026-07-21T12:00:00.000Z",
    tasks: [
      { taskId: "QK-1", title: "Add Campaigns UI projection", status: "running" },
      { taskId: "QK-2", title: "Add Task History UI projection", status: "queued" },
    ],
    waves: [{ id: "w1", label: "Wave 1" }],
    runners: [{ id: "r1", kind: "cursor", model: "composer-2.5" }],
    commits: [{ sha: "a".repeat(40), message: "feat: add campaigns projection" }],
    pullRequests: [{ number: 41, title: "Campaigns UI projection", url: "https://github.com/org/repo/pull/41", state: "open" }],
    verification: [{ label: "pnpm test", outcome: "passed" }],
    sync: { pending: 0, conflicts: 0 },
  },
};

export function fakeCampaignReadPort(overrides?: {
  summaries?: readonly UiCampaignSummaryItem[];
  details?: Record<string, UiCampaignDetail>;
}): CampaignReadPort {
  const summaries = overrides?.summaries ?? SUMMARIES;
  const details = overrides?.details ?? DETAILS;
  return {
    listSummaries: async (input) => {
      if (!input.repositoryId) return summaries;
      return summaries.filter((item) => item.repositoryId === input.repositoryId);
    },
    getDetail: async (campaignId) => {
      const detail = details[campaignId];
      if (!detail) throw new Error(`Unknown campaign ${campaignId}`);
      return detail;
    },
    getPlanProgress: async ({ taskId, campaignId }) => {
      if (campaignId === "C-1" && taskId === "QK-1") {
        return buildPlanProgressProjection(fixtureWithReportedCompletion());
      }
      return buildPlanProgressProjection({ campaignId, taskId, refreshedAt: new Date().toISOString() });
    },
  };
}
