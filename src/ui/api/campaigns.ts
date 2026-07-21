import type { IncomingMessage, ServerResponse } from "node:http";
import type { CampaignReadPort } from "../ports/campaign-read.js";
import { buildCampaignDetail, buildCampaignList } from "../read-models/campaigns.js";
import { sendJson } from "./errors.js";

const DETAIL_PATTERN = /^\/api\/v1\/campaigns\/([^/]+)$/;

export function matchesCampaignsRoute(pathname: string): boolean {
  return pathname === "/api/v1/campaigns" || DETAIL_PATTERN.test(pathname);
}

export async function handleCampaigns(
  _req: IncomingMessage,
  res: ServerResponse,
  options: { url: URL; port: CampaignReadPort },
): Promise<void> {
  const match = DETAIL_PATTERN.exec(options.url.pathname);
  if (match) {
    const campaignId = decodeURIComponent(match[1] ?? "");
    try {
      const detail = await buildCampaignDetail(options.port, campaignId);
      return sendJson(res, 200, detail);
    } catch {
      return sendJson(res, 404, { schemaVersion: 1, result: "invalid" });
    }
  }
  const repositoryId = options.url.searchParams.get("repositoryId");
  const items = await buildCampaignList(options.port, repositoryId ? { repositoryId } : {});
  sendJson(res, 200, { schemaVersion: 1, items });
}
