import type { IncomingMessage, ServerResponse } from "node:http";
import { QuirksError } from "../../core/errors.js";
import { validateSchema } from "../../schema/validate.js";
import { isApprovalToken } from "../approval/token-store.js";
import { isViewerToken } from "../auth/viewer-session-store.js";
import type { LoopbackAuthority } from "../authority.js";
import { readJsonBody } from "../request.js";
import type { ApprovalWritePort } from "../ports/approval-write.js";
import { sendJson } from "./errors.js";

type CampaignRecord = { repositoryId: string; envelopeDigest: string };

export async function handleApproval(
  req: IncomingMessage,
  res: ServerResponse,
  options: {
    authority: LoopbackAuthority;
    repositoryId: string;
    bearer: string;
    approval: ApprovalWritePort;
    getCampaign: (campaignId: string) => CampaignRecord | undefined;
    now?: () => string;
    onApproveAttempt?: () => void;
  },
): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { schemaVersion: 1, result: "invalid" });
  const contentType = req.headers["content-type"]?.split(";", 1)[0];
  if (contentType !== "application/json") return sendJson(res, 415, { schemaVersion: 1, result: "invalid" });
  if (req.headers.origin !== options.authority.origin || req.headers["sec-fetch-site"] !== "same-origin") {
    return sendJson(res, 403, { schemaVersion: 1, result: "invalid" });
  }
  let raw: unknown;
  try {
    raw = await readJsonBody(req);
  } catch (error) {
    if (error instanceof QuirksError && error.message === "UI_PAYLOAD_TOO_LARGE") {
      return sendJson(res, 413, { schemaVersion: 1, result: "invalid" });
    }
    return sendJson(res, 400, { schemaVersion: 1, result: "invalid" });
  }
  const approvalToken =
    typeof raw === "object" && raw !== null && "approvalToken" in raw
      ? (raw as { approvalToken: unknown }).approvalToken
      : undefined;
  if (
    typeof approvalToken !== "string" ||
    !isViewerToken(options.bearer) ||
    !isApprovalToken(approvalToken) ||
    options.bearer === approvalToken
  ) {
    return sendJson(res, 200, { schemaVersion: 1, result: "invalid" });
  }
  let body: { schemaVersion: 1; campaignId: string; envelopeDigest: string; approvalToken: string };
  try {
    body = validateSchema("ui-approval-request-v1", raw);
  } catch {
    return sendJson(res, 400, { schemaVersion: 1, result: "invalid" });
  }
  if (!isViewerToken(options.bearer) || !isApprovalToken(body.approvalToken) || options.bearer === body.approvalToken) {
    return sendJson(res, 200, { schemaVersion: 1, result: "invalid" });
  }
  const campaign = options.getCampaign(body.campaignId);
  if (!campaign || campaign.repositoryId !== options.repositoryId) {
    return sendJson(res, 403, { schemaVersion: 1, result: "invalid" });
  }
  if (body.envelopeDigest !== campaign.envelopeDigest) {
    return sendJson(res, 200, { schemaVersion: 1, result: "stale" });
  }
  options.onApproveAttempt?.();
  const outcome = await options.approval.approve({
    campaignId: body.campaignId,
    envelopeDigest: body.envelopeDigest,
    approvalToken: body.approvalToken,
    operator: { label: "local-ui", evidence: "loopback-session" },
  });
  sendJson(res, 200, validateSchema("ui-approval-response-v1", { schemaVersion: 1, ...outcome }));
}
