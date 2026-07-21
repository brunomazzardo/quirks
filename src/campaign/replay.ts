import { applyEvent, initialSnapshot } from "./state-machine.js";
import type { CampaignEvent, CampaignSnapshot } from "./types.js";

export function replayEvents(campaignId: string, digest: string, events: readonly CampaignEvent[]): CampaignSnapshot {
  return events.reduce((snapshot, event) => applyEvent(snapshot, event), initialSnapshot(campaignId, digest));
}
