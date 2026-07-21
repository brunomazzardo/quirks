import type { IncomingMessage, ServerResponse } from "node:http";
import type { CampaignStatus } from "../campaign/types.js";
import type { ProjectContext } from "../project/types.js";
import type { LoopbackAuthority } from "./authority.js";
import { handleApproval } from "./api/approval.js";
import { handleExistingTasks } from "./api/existing-tasks.js";
import { handlePreflight } from "./api/preflight.js";
import { sendJson, UNAUTHORIZED_BODY } from "./api/errors.js";
import type { ApprovalWritePort } from "./ports/approval-write.js";
import type { PreflightReadPort } from "./ports/preflight-read.js";
import type { ViewerSessionPort } from "./ports/viewer-session.js";

export type CampaignRecord = { repositoryId: string; envelopeDigest: string; status?: CampaignStatus };

export interface UiRouterOptions {
  authority: LoopbackAuthority;
  repositoryId: string;
  viewerSession: ViewerSessionPort;
  approval: ApprovalWritePort;
  getCampaign: (campaignId: string) => CampaignRecord | undefined;
  getProjectContext?: () => Promise<ProjectContext>;
  preflightRead?: PreflightReadPort;
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
  if (url.pathname === "/api/v1/existing-tasks") {
    if (!options.getProjectContext) {
      return sendJson(res, 503, { schemaVersion: 1, result: "invalid" });
    }
    return handleExistingTasks(res, {
      getProjectContext: options.getProjectContext,
      ...(options.now ? { now: options.now } : {}),
    });
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
  return sendJson(res, 200, { schemaVersion: 1, route: url.pathname, refreshedAt: options.now?.() ?? new Date().toISOString() });
}
