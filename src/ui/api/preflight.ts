import type { ServerResponse } from "node:http";
import type { CampaignRecord } from "../router.js";
import type { PreflightReadPort } from "../ports/preflight-read.js";
import { buildPreflightResponse } from "../read-models/preflight-proposal.js";
import { sendJson } from "./errors.js";

const NOT_FOUND_BODY = { schemaVersion: 1, result: "invalid" } as const;

export async function handlePreflight(
  res: ServerResponse,
  options: {
    campaignId: string;
    getCampaign: (campaignId: string) => CampaignRecord | undefined;
    preflightRead: PreflightReadPort;
  },
): Promise<void> {
  // A campaign record with a known non-awaiting status fails fast. Records
  // without a status (standalone read-only workspaces resolve campaigns from
  // durable state, not a static map) defer to the read port, which re-reads
  // state.json and refuses anything that is not awaiting approval.
  const campaign = options.getCampaign(options.campaignId);
  if (campaign?.status !== undefined && campaign.status !== "awaiting_approval") {
    return sendJson(res, 404, NOT_FOUND_BODY);
  }
  let proposal;
  try {
    proposal = await buildPreflightResponse(options.preflightRead, options.campaignId);
  } catch {
    return sendJson(res, 404, NOT_FOUND_BODY);
  }
  sendJson(res, 200, proposal);
}
