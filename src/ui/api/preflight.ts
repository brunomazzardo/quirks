import type { ServerResponse } from "node:http";
import type { CampaignRecord } from "../router.js";
import type { PreflightReadPort } from "../ports/preflight-read.js";
import { buildPreflightResponse } from "../read-models/preflight-proposal.js";
import { sendJson } from "./errors.js";

export async function handlePreflight(
  res: ServerResponse,
  options: {
    campaignId: string;
    getCampaign: (campaignId: string) => CampaignRecord | undefined;
    preflightRead: PreflightReadPort;
  },
): Promise<void> {
  const campaign = options.getCampaign(options.campaignId);
  if (!campaign || campaign.status !== "awaiting_approval") {
    return sendJson(res, 404, { schemaVersion: 1, result: "invalid" });
  }
  const proposal = await buildPreflightResponse(options.preflightRead, options.campaignId);
  sendJson(res, 200, proposal);
}
