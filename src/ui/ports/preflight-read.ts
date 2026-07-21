import type { UiPreflightProposalV1 } from "../types/preflight-proposal.js";

export interface PreflightReadPort {
  getProposal(campaignId: string): Promise<UiPreflightProposalV1>;
}
