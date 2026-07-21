import type { IncomingMessage, ServerResponse } from "node:http";
import type { CampaignReadPort } from "../ports/campaign-read.js";
import { buildPlanProgressProjection } from "../read-models/plan-progress.js";
import { sendJson } from "./errors.js";

const PLAN_PROGRESS_PATTERN = /^\/api\/v1\/tasks\/([^/]+)\/plan-progress$/;

export function matchPlanProgressRoute(pathname: string): string | undefined {
  const match = PLAN_PROGRESS_PATTERN.exec(pathname);
  return match ? decodeURIComponent(match[1] ?? "") : undefined;
}

export async function handlePlanProgress(
  req: IncomingMessage,
  res: ServerResponse,
  options: { taskId: string; port: CampaignReadPort; now?: () => string },
): Promise<void> {
  const campaignId = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("campaignId");
  if (!campaignId) {
    return sendJson(res, 400, { schemaVersion: 1, result: "invalid" });
  }
  try {
    const projection = await options.port.getPlanProgress({ taskId: options.taskId, campaignId });
    res.setHeader("Cache-Control", "no-store");
    return sendJson(res, 200, projection);
  } catch {
    return sendJson(res, 404, { schemaVersion: 1, result: "invalid" });
  }
}

export function fixtureWithReportedCompletion(): Parameters<typeof buildPlanProgressProjection>[0] {
  return {
    campaignId: "C-1",
    taskId: "QK-1",
    refreshedAt: "2026-07-21T18:00:10.000Z",
    journalEvent: {
      status: "reported_complete",
      stage: "commit",
      tddPhase: null,
      currentStepKey: "task-14/step-3",
      note: "Worker reports done",
      workerReportedAt: "2026-07-21T18:00:09.000Z",
      controllerObservedAt: "2026-07-21T18:00:10.000Z",
      completedStepIds: ["task-14/step-1", "task-14/step-2", "task-14/step-3"],
      jobId: "job-1",
      agentLabel: "implementer",
      runnerKind: "cursor",
      model: "composer-2.5",
    },
  };
}
