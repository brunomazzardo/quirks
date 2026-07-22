import type { JudgmentTier } from "../campaign/types.js";
import type { PromptProfileContext } from "./types.js";

const TIER_RANK: Record<JudgmentTier, number> = {
  mechanical: 0,
  standard: 1,
  high: 2,
  principal: 3,
};

/**
 * Deterministic model family derivation: the leading alphabetic run of the
 * model identifier. Different variants of one family (gpt-5.6-sol,
 * gpt-5.6-terra) share a family; opus/composer/gpt differ.
 */
export function deriveModelFamily(model: string): string {
  const match = /^[a-z]+/i.exec(model.trim());
  return (match?.[0] ?? model).toLowerCase();
}

export interface SelectIndependentReviewerInput {
  implementer: PromptProfileContext;
  requiredTier: JudgmentTier;
  approved: readonly PromptProfileContext[];
}

export type ReviewerSelection =
  | { kind: "independent"; profile: PromptProfileContext; reason: string }
  | { kind: "independence-unavailable"; reason: string };

/**
 * Select a review-capable profile from a different approved model family.
 * Excludes the implementer profile and its model family, requires the
 * computed reviewer tier, and preserves approved-profile order as the final
 * deterministic tie-breaker. Never invents a route and never labels a
 * same-family fallback as independent.
 */
export function selectIndependentReviewer(input: SelectIndependentReviewerInput): ReviewerSelection {
  const implementerFamily = input.implementer.modelFamily;
  const candidates = input.approved.filter(
    (profile) =>
      profile.profileId !== input.implementer.profileId &&
      profile.modelFamily !== implementerFamily,
  );
  const qualified = candidates.filter((profile) => TIER_RANK[profile.tier] >= TIER_RANK[input.requiredTier]);
  const chosen = qualified[0];
  if (!chosen) {
    const reason =
      candidates.length === 0
        ? `No approved profile outside the ${implementerFamily} model family is available`
        : `No approved profile outside the ${implementerFamily} model family meets the required ${input.requiredTier} tier`;
    return { kind: "independence-unavailable", reason };
  }
  return {
    kind: "independent",
    profile: chosen,
    reason:
      `Selected ${chosen.profileId} (${chosen.modelFamily} family) as an independent reviewer ` +
      `distinct from implementer ${input.implementer.profileId} (${implementerFamily} family)`,
  };
}
