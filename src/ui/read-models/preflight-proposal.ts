import { QuirksError } from "../../core/errors.js";
import { validateSchema } from "../../schema/validate.js";
import type { PreflightReadPort } from "../ports/preflight-read.js";
import type { UiPreflightProposalV1 } from "../types/preflight-proposal.js";

export async function buildPreflightResponse(
  port: PreflightReadPort,
  campaignId: string,
): Promise<UiPreflightProposalV1> {
  const proposal = await port.getProposal(campaignId);
  const validated = validateSchema<UiPreflightProposalV1>("ui-preflight-proposal-v1", proposal);
  if (validated.approval.envelopeDigest !== validated.envelopeDigest) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Preflight approval digest does not match envelope digest");
  }
  if (validated.campaignId !== campaignId) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Preflight campaign id does not match request");
  }
  return validated;
}
