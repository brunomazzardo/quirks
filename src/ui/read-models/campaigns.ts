import { validateSchema } from "../../schema/validate.js";
import type { CampaignReadPort, UiCampaignDetail, UiCampaignSummaryItem } from "../ports/campaign-read.js";

export async function buildCampaignList(
  port: CampaignReadPort,
  input: { repositoryId?: string },
): Promise<readonly UiCampaignSummaryItem[]> {
  const items = await port.listSummaries(input);
  const validated = validateSchema<{ schemaVersion: 1; items: UiCampaignSummaryItem[] }>("ui-campaign-summary-v1", {
    schemaVersion: 1,
    items,
  });
  return validated.items;
}

export async function buildCampaignDetail(
  port: CampaignReadPort,
  campaignId: string,
): Promise<UiCampaignDetail & { canRunAgain: true }> {
  const detail = await port.getDetail(campaignId);
  return validateSchema<UiCampaignDetail & { schemaVersion: 1; canRunAgain: true }>("ui-campaign-detail-v1", {
    schemaVersion: 1,
    ...detail,
    canRunAgain: true,
  });
}
