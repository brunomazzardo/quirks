import type { IncomingMessage, ServerResponse } from "node:http";
import type { CampaignStatus } from "../campaign/types.js";
import type { ProjectContext } from "../project/types.js";
import type { LoopbackAuthority } from "./authority.js";
import { handleApproval } from "./api/approval.js";
import { handleCampaigns, matchesCampaignsRoute } from "./api/campaigns.js";
import { handleExistingTasks } from "./api/existing-tasks.js";
import { handlePreflight } from "./api/preflight.js";
import { sendJson, UNAUTHORIZED_BODY } from "./api/errors.js";
import { handlePlanProgress, matchPlanProgressRoute } from "./api/plan-progress.js";
import { handlePrompts } from "./api/prompts.js";
import { handleTaskHistory, matchTaskHistoryRoute, type TaskHistorySource } from "./api/task-history.js";
import type { ApprovalWritePort } from "./ports/approval-write.js";
import type { CampaignReadPort } from "./ports/campaign-read.js";
import type { PreflightReadPort } from "./ports/preflight-read.js";
import type { PromptReadPort } from "./ports/prompt-read.js";
import type { ViewerSessionPort } from "./ports/viewer-session.js";
import { matchShellRoute, renderShell } from "./shell.js";

export type CampaignRecord = { repositoryId: string; envelopeDigest: string; status?: CampaignStatus };

export interface UiRouterOptions {
  authority: LoopbackAuthority;
  repositoryId: string;
  viewerSession: ViewerSessionPort;
  approval: ApprovalWritePort;
  getCampaign: (campaignId: string) => CampaignRecord | undefined;
  getProjectContext?: () => Promise<ProjectContext>;
  preflightRead?: PreflightReadPort;
  campaignRead?: CampaignReadPort;
  taskHistory?: TaskHistorySource;
  promptRead?: PromptReadPort;
  readOnly?: boolean;
  now?: () => string;
  onRead?: () => void;
  onApproveAttempt?: () => void;
  clientScript?: string;
  nonce?: string;
}

function bearer(req: IncomingMessage): string | undefined {
  const value = req.headers.authorization;
  return value?.startsWith("Bearer ") ? value.slice(7) : undefined;
}

function isReadRoute(pathname: string): boolean {
  return (
    pathname === "/api/v1/existing-tasks" ||
    pathname === "/api/v1/prompts" ||
    pathname === "/api/v1/campaigns" ||
    /^\/api\/v1\/campaigns\/[^/]+$/.test(pathname) ||
    /^\/api\/v1\/campaigns\/[^/]+\/preflight$/.test(pathname) ||
    /^\/api\/v1\/tasks\/[^/]+\/history$/.test(pathname) ||
    /^\/api\/v1\/tasks\/[^/]+\/plan-progress$/.test(pathname)
  );
}

async function routeApiRequest(req: IncomingMessage, res: ServerResponse, options: UiRouterOptions, url: URL): Promise<void> {
  if (url.pathname === "/api/v1/approval" && req.method !== "POST") {
    return sendJson(res, 405, { schemaVersion: 1, result: "invalid" });
  }
  if (url.pathname !== "/api/v1/approval" && req.method !== "GET") {
    return sendJson(res, 405, { schemaVersion: 1, result: "invalid" });
  }
  const token = bearer(req);
  if (!token) return sendJson(res, 401, UNAUTHORIZED_BODY);
  const authorization = await options.viewerSession.authorize({
    viewerToken: token,
    repositoryId: options.repositoryId,
    ...(options.now ? { now: options.now() } : {}),
  });
  if (authorization.result !== "authorized") return sendJson(res, 401, UNAUTHORIZED_BODY);
  if (url.pathname === "/api/v1/approval") {
    if (options.readOnly) {
      return sendJson(res, 409, { schemaVersion: 1, result: "invalid", error: "read_only_workspace" });
    }
    return handleApproval(req, res, {
      authority: options.authority,
      repositoryId: options.repositoryId,
      bearer: token,
      approval: options.approval,
      getCampaign: options.getCampaign,
      ...(options.now ? { now: options.now } : {}),
      ...(options.onApproveAttempt ? { onApproveAttempt: options.onApproveAttempt } : {}),
    });
  }
  if (!isReadRoute(url.pathname)) {
    return sendJson(res, 404, { schemaVersion: 1, result: "invalid" });
  }
  options.onRead?.();
  if (url.pathname === "/api/v1/existing-tasks") {
    if (!options.getProjectContext) {
      return sendJson(res, 503, { schemaVersion: 1, result: "invalid" });
    }
    return handleExistingTasks(res, {
      getProjectContext: options.getProjectContext,
      ...(options.now ? { now: options.now } : {}),
    });
  }
  if (url.pathname === "/api/v1/prompts") {
    if (!options.promptRead) {
      return sendJson(res, 503, { schemaVersion: 1, result: "invalid" });
    }
    return handlePrompts(res, { url, port: options.promptRead });
  }
  const preflightMatch = /^\/api\/v1\/campaigns\/([^/]+)\/preflight$/.exec(url.pathname);
  if (preflightMatch) {
    if (!options.preflightRead) {
      return sendJson(res, 503, { schemaVersion: 1, result: "invalid" });
    }
    return handlePreflight(res, {
      campaignId: preflightMatch[1]!,
      getCampaign: options.getCampaign,
      preflightRead: options.preflightRead,
    });
  }
  if (matchesCampaignsRoute(url.pathname)) {
    if (!options.campaignRead) {
      return sendJson(res, 503, { schemaVersion: 1, result: "invalid" });
    }
    return handleCampaigns(req, res, { url, port: options.campaignRead });
  }
  const taskId = matchTaskHistoryRoute(url.pathname);
  if (taskId) {
    if (!options.taskHistory) {
      return sendJson(res, 503, { schemaVersion: 1, result: "invalid" });
    }
    return handleTaskHistory(req, res, { taskId, source: options.taskHistory });
  }
  const progressTaskId = matchPlanProgressRoute(url.pathname);
  if (progressTaskId) {
    if (!options.campaignRead) {
      return sendJson(res, 503, { schemaVersion: 1, result: "invalid" });
    }
    return handlePlanProgress(req, res, {
      taskId: progressTaskId,
      port: options.campaignRead,
      ...(options.now ? { now: options.now } : {}),
    });
  }
  // Every read route enumerated by isReadRoute is handled above; a missing
  // port is an explicit 503, never a fabricated 200 body without projection
  // fields (that fabrication is what crashed the campaign detail client).
  return sendJson(res, 404, { schemaVersion: 1, result: "invalid" });
}

function routeShellRequest(req: IncomingMessage, res: ServerResponse, options: UiRouterOptions, url: URL): void {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end();
    return;
  }
  if (!matchShellRoute(url.pathname)) {
    res.statusCode = 404;
    res.end();
    return;
  }
  if (!options.nonce) {
    res.statusCode = 500;
    res.end();
    return;
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(renderShell({ nonce: options.nonce, clientScript: options.clientScript ?? "" }));
}

export async function routeUiRequest(req: IncomingMessage, res: ServerResponse, options: UiRouterOptions): Promise<void> {
  const url = new URL(req.url ?? "/", options.authority.origin);
  if (url.pathname.startsWith("/api/")) {
    return routeApiRequest(req, res, options, url);
  }
  routeShellRequest(req, res, options, url);
}
