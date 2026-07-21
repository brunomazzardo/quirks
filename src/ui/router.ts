import type { IncomingMessage, ServerResponse } from "node:http";
import type { LoopbackAuthority } from "./authority.js";
import { handleApproval } from "./api/approval.js";
import { handleCampaigns, matchesCampaignsRoute } from "./api/campaigns.js";
import { sendJson, UNAUTHORIZED_BODY } from "./api/errors.js";
import { handleTaskHistory, matchTaskHistoryRoute, type TaskHistorySource } from "./api/task-history.js";
import type { ApprovalWritePort } from "./ports/approval-write.js";
import type { CampaignReadPort } from "./ports/campaign-read.js";
import type { ViewerSessionPort } from "./ports/viewer-session.js";

export type CampaignRecord = { repositoryId: string; envelopeDigest: string };

export interface UiRouterOptions {
  authority: LoopbackAuthority;
  repositoryId: string;
  viewerSession: ViewerSessionPort;
  approval: ApprovalWritePort;
  getCampaign: (campaignId: string) => CampaignRecord | undefined;
  campaignRead?: CampaignReadPort;
  taskHistory?: TaskHistorySource;
  now?: () => string;
  onRead?: () => void;
  onApproveAttempt?: () => void;
}

function bearer(req: IncomingMessage): string | undefined {
  const value = req.headers.authorization;
  return value?.startsWith("Bearer ") ? value.slice(7) : undefined;
}

function isReadRoute(pathname: string): boolean {
  return (
    pathname === "/api/v1/existing-tasks" ||
    pathname === "/api/v1/campaigns" ||
    /^\/api\/v1\/campaigns\/[^/]+$/.test(pathname) ||
    /^\/api\/v1\/campaigns\/[^/]+\/preflight$/.test(pathname) ||
    /^\/api\/v1\/tasks\/[^/]+\/history$/.test(pathname) ||
    /^\/api\/v1\/tasks\/[^/]+\/plan-progress$/.test(pathname)
  );
}

export async function routeUiRequest(req: IncomingMessage, res: ServerResponse, options: UiRouterOptions): Promise<void> {
  const url = new URL(req.url ?? "/", options.authority.origin);
  if (!url.pathname.startsWith("/api/")) {
    res.statusCode = 404;
    res.end();
    return;
  }
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
  if (options.campaignRead && matchesCampaignsRoute(url.pathname)) {
    return handleCampaigns(req, res, { url, port: options.campaignRead });
  }
  const taskId = matchTaskHistoryRoute(url.pathname);
  if (options.taskHistory && taskId) {
    return handleTaskHistory(req, res, { taskId, source: options.taskHistory });
  }
  return sendJson(res, 200, { schemaVersion: 1, route: url.pathname, refreshedAt: options.now?.() ?? new Date().toISOString() });
}
