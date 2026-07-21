import type { ServerResponse } from "node:http";
import type { ProjectContext } from "../../project/types.js";
import { buildExistingTasksProjection } from "../read-models/existing-tasks.js";
import { sendJson } from "./errors.js";

export async function handleExistingTasks(
  res: ServerResponse,
  options: {
    getProjectContext: () => Promise<ProjectContext>;
    now?: () => string;
  },
): Promise<void> {
  const context = await options.getProjectContext();
  const projection = await buildExistingTasksProjection(
    context,
    options.now ? { now: options.now } : {},
  );
  sendJson(res, 200, projection);
}
