import type { ServerResponse } from "node:http";
import type { PromptContextKind } from "../../prompt/types.js";
import type { PromptReadPort, PromptReadRequest } from "../ports/prompt-read.js";
import { buildPromptSet } from "../read-models/prompts.js";
import { sendJson } from "./errors.js";

const CONTEXT_KINDS: readonly PromptContextKind[] = ["campaign", "task", "plan", "review"];
const ALLOWED_PARAMS = new Set(["contextKind", "campaignId", "taskId"]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function parsePromptQuery(url: URL): PromptReadRequest | undefined {
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_PARAMS.has(key)) return undefined;
  }
  const contextKind = url.searchParams.get("contextKind");
  if (!contextKind || !CONTEXT_KINDS.includes(contextKind as PromptContextKind)) return undefined;
  const campaignId = url.searchParams.get("campaignId") ?? undefined;
  const taskId = url.searchParams.get("taskId") ?? undefined;
  if (campaignId !== undefined && !ID_PATTERN.test(campaignId)) return undefined;
  if (taskId !== undefined && !ID_PATTERN.test(taskId)) return undefined;

  const kind = contextKind as PromptContextKind;
  if ((kind === "campaign" || kind === "plan") && campaignId === undefined) return undefined;
  if ((kind === "task" || kind === "review") && taskId === undefined) return undefined;

  return {
    contextKind: kind,
    ...(campaignId !== undefined ? { campaignId } : {}),
    ...(taskId !== undefined ? { taskId } : {}),
  };
}

export async function handlePrompts(
  res: ServerResponse,
  options: { url: URL; port: PromptReadPort },
): Promise<void> {
  const request = parsePromptQuery(options.url);
  if (!request) {
    return sendJson(res, 400, { schemaVersion: 1, result: "invalid" });
  }
  try {
    const context = await options.port.getContext(request);
    const projection = buildPromptSet(context);
    res.setHeader("Cache-Control", "no-store");
    return sendJson(res, 200, projection);
  } catch {
    return sendJson(res, 404, { schemaVersion: 1, result: "invalid" });
  }
}
