import { canonicalJson } from "../core/canonical-json.js";
import { sha256 } from "../core/hash.js";
import { QuirksError } from "../core/errors.js";
import type { CampaignEnvelope } from "./types.js";

export type EnvelopeInput = Omit<CampaignEnvelope, "digest">;

export function stripDigest(envelope: CampaignEnvelope): EnvelopeInput {
  const { digest: _digest, ...rest } = envelope;
  return rest;
}

export function computeEnvelopeDigest(input: EnvelopeInput): string {
  return sha256(JSON.parse(canonicalJson(input)));
}

export function finalizeEnvelope(input: EnvelopeInput): CampaignEnvelope {
  return { ...input, digest: computeEnvelopeDigest(input) };
}

export function assertEnvelopeUnchanged(approved: CampaignEnvelope, candidate: EnvelopeInput): void {
  const candidateDigest = computeEnvelopeDigest(candidate);
  if (approved.digest !== candidateDigest) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Campaign envelope drift requires new approval", {
      approvedDigest: approved.digest,
      candidateDigest,
    });
  }
}
