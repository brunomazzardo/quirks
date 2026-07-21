import type { IncomingMessage, ServerResponse } from "node:http";
import type { TaskHistory } from "../../provenance/types.js";
import { buildTaskHistoryProjection } from "../read-models/task-history.js";
import { sendJson } from "./errors.js";

const HISTORY_PATTERN = /^\/api\/v1\/tasks\/([^/]+)\/history$/;

export function matchTaskHistoryRoute(pathname: string): string | undefined {
  const match = HISTORY_PATTERN.exec(pathname);
  return match ? decodeURIComponent(match[1] ?? "") : undefined;
}

export interface TaskHistorySource {
  getHistory(taskId: string): Promise<TaskHistory>;
}

export async function handleTaskHistory(
  _req: IncomingMessage,
  res: ServerResponse,
  options: { taskId: string; source: TaskHistorySource },
): Promise<void> {
  try {
    const history = await options.source.getHistory(options.taskId);
    const projection = await buildTaskHistoryProjection(history);
    sendJson(res, 200, projection);
  } catch {
    sendJson(res, 404, { schemaVersion: 1, result: "invalid" });
  }
}
