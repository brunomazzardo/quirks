// The judgment tier ladder and what each tier resolves to (QK-HARN-001, D7).
// Ported from v1 src/campaign/routing.ts + src/prompt/model-selection.ts —
// those two files are the whole of what v1 actually computed about tiers.
//
// Every model id here was exercised against a real CLI in
// docs/evidence/runner-boundary-probe.md. Nothing is invented: a runner with no
// probed model at a tier resolves to null, and callers render that as unknown
// rather than guessing (same rule as RunPlanEntry.estimatedCost).

// Ported verbatim from the bun-era src/harness/tiers.ts (QK-MONO-005).

import type { RunnerKind } from "@quirks/contracts";
import { claudeEffort } from "../runner/Claude.ts";
import { codexReasoningEffort } from "../runner/Codex.ts";

export type JudgmentTier = "mechanical" | "standard" | "high" | "principal";

export const TIERS: readonly JudgmentTier[] = ["mechanical", "standard", "high", "principal"];

const TIER_RANK: Readonly<Record<JudgmentTier, number>> = {
  mechanical: 0,
  standard: 1,
  high: 2,
  principal: 3,
};

export function isTier(value: string): value is JudgmentTier {
  return Object.prototype.hasOwnProperty.call(TIER_RANK, value);
}

export function tierRank(tier: JudgmentTier): number {
  return TIER_RANK[tier];
}

/** Saturates at principal — there is nothing above it. */
export function tierAbove(tier: JudgmentTier): JudgmentTier {
  switch (tier) {
    case "mechanical":
      return "standard";
    case "standard":
      return "high";
    case "high":
      return "principal";
    case "principal":
      return "principal";
  }
}

function higherTier(left: JudgmentTier, right: JudgmentTier): JudgmentTier {
  return TIER_RANK[left] >= TIER_RANK[right] ? left : right;
}

/** Risks where review is judgment-heavy enough to floor the reviewer at `high`. */
const JUDGMENT_HEAVY_RISKS: readonly string[] = [
  "architecture",
  "security",
  "identity",
  "concurrency",
  "protocol",
  "production",
  "destructive-migration",
];

/** v2 keeps `risk` as free text ("free text, no ceremony"), so match on substrings. */
export function isJudgmentHeavy(risk: string | undefined): boolean {
  if (!risk) return false;
  const lowered = risk.toLowerCase();
  return JUDGMENT_HEAVY_RISKS.some((entry) => lowered.includes(entry));
}

/** Free-text effort → a tier. Unrecognized effort is `standard`, never a guess upward. */
export function tierForEffort(effort: string | undefined): JudgmentTier {
  if (effort && isTier(effort)) return effort;
  return "standard";
}

export type JudgmentRole = "supervisor" | "implementer" | "reviewer";

/**
 * v1's `requiredTierForRole`, carried over exactly: a supervisor always holds
 * the top tier, an implementer works at its own effort, and a reviewer sits one
 * tier above — floored at `high` when the risk makes review judgment-heavy.
 */
export function requiredTierForRole(
  role: JudgmentRole,
  effort: JudgmentTier,
  risk?: string,
): JudgmentTier {
  if (role === "supervisor") return "principal";
  if (role === "implementer") return effort;
  const elevated = tierAbove(effort);
  return isJudgmentHeavy(risk) ? higherTier(elevated, "high") : elevated;
}

/**
 * The leading alphabetic run of a model id. Variants of one family share it
 * (`gpt-5.6-sol` and `gpt-5.6-terra` are both `gpt`); `opus`, `composer`, and
 * `gpt` differ. This is what makes "a reviewer on a different model" checkable
 * instead of a string comparison that `opus` vs `opus` would pass by accident.
 */
export function deriveModelFamily(model: string): string {
  const match = /^[a-z]+/i.exec(model.trim());
  return (match?.[0] ?? model).toLowerCase();
}

/** Canonical ids, longest-match-first so `claude-opus-4-8` never resolves via a
 *  shorter sibling. Extend when a runner starts serving a model we route to. */
const CANONICAL_MODELS: readonly string[] = [
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-sonnet-5",
  "claude-haiku-4-5",
  "claude-fable-5",
];

/** Short names the claude CLI accepts for the current model of each tier
 *  (`--model` takes "an alias for the latest model … or the model's full name"). */
const MODEL_ALIASES: Readonly<Record<string, string>> = {
  opus: "claude-opus-5",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5",
  fable: "claude-fable-5",
};

/**
 * One identity per underlying model, whatever it is called.
 *
 * `deriveModelFamily` alone certifies a false independence: the alias `opus`
 * derives family "opus", while cursor's `claude-opus-5-thinking-high` derives
 * "claude" — different families, the same Claude Opus 5. That matters because
 * **88 of cursor's 193 published models are `claude-*`**, so "the parent never
 * reviews its own task's work" would be satisfiable on paper by two names for one
 * model. Aliases resolve to canonical ids, decorated ids collapse to the id they
 * decorate, and anything unrecognized falls back to the family.
 */
export function canonicalModel(model: string): string {
  const normalized = model.trim().toLowerCase();
  const alias = MODEL_ALIASES[normalized];
  if (alias) return alias;
  let longest = "";
  for (const id of CANONICAL_MODELS) {
    if (normalized.startsWith(id) && id.length > longest.length) longest = id;
  }
  return longest || deriveModelFamily(normalized);
}

export interface TierResolution {
  /** The `--model` value. Null when no model has been probed at this tier. */
  model: string | null;
  /** The runner's own effort flag for this tier, when it takes one. */
  effort: string | null;
}

/**
 * Tier → model per runner. Sources, all real CLI runs:
 *   claude  `sonnet`, `opus`   — runner-boundary-probe.md:23-26,77-78
 *                                (`--model opus` canonicalized to claude-opus-5)
 *           `haiku`            — the documented alias; NOT probed. See the note
 *                                below before routing judgment work to it.
 *   codex   `gpt-5.5`          — runner-boundary-probe.md:27
 *           `gpt-5.6-terra`    — runner-boundary-probe.md:28
 *           `gpt-5.6-sol`      — runner-boundary-probe.md:29
 *   cursor  `composer-2.5`     — runner-boundary-probe.md:30,52
 *
 * `high` and `principal` share a model on claude and cursor because that is the
 * truth — effort, not a different model, separates them. The consequence is that
 * a reviewer for a high/principal task cannot be independent within that runner;
 * `selectIndependentReviewer` reports that rather than papering over it.
 *
 * Note (docs/specs/managing-agent-runner.md:117): haiku was rejected for the
 * quote interpreter because "refusing to guess" is where a smaller model drifts
 * invisibly. That is a different role from these tiers, but it is why nothing
 * above `mechanical` resolves to haiku.
 */
export const TIER_TABLE: Readonly<
  Record<RunnerKind, Readonly<Record<JudgmentTier, string | null>>>
> = {
  claude: {
    mechanical: "haiku",
    standard: "sonnet",
    high: "opus",
    principal: "opus",
  },
  codex: {
    mechanical: null,
    standard: "gpt-5.5",
    high: "gpt-5.6-terra",
    principal: "gpt-5.6-sol",
  },
  // cursor: `composer-2.5` chosen deliberately over the alternatives, even though
  // it leaves `mechanical` blank. `cursor-agent --list-models` publishes 193
  // models and composer has exactly two entries (`composer-2.5`, `-2.5-fast`) with
  // no tier ladder, so there is no honest mechanical rung to name. The available
  // full ladders were rejected: `gpt-5.3-codex-{low,,high,xhigh}` is family "gpt",
  // the same as codex's own models, which would cost us cursor's ability to
  // independently review codex work; and cursor's `claude-*` rungs share identity
  // with claude's. Composer keeps three distinct identities across three runners,
  // which is what makes cross-vendor review real at high and principal tier.
  // A truthful blank beats a filled cell that removes a reviewer. (Operator
  // decision, 2026-07-28.)
  cursor: {
    mechanical: null,
    standard: "composer-2.5",
    high: "composer-2.5",
    principal: "composer-2.5",
  },
};

/**
 * The effort value each runner takes for a tier, or null when it cannot be
 * expressed for the model we route to.
 *
 * cursor is null for a narrower reason than an earlier comment here claimed:
 * `cursor-agent` has no `--effort` *flag*, but it does express effort — in the
 * model id (`gpt-5.3-codex-low` / `-high` / `-xhigh`) and via parameterized
 * syntax (`claude-opus-4-8[context=1m,effort=high]`). It is `composer-2.5`
 * specifically that publishes no rungs, so there is nothing to set.
 */
export function effortForTier(runner: RunnerKind, tier: JudgmentTier): string | null {
  switch (runner) {
    case "claude":
      return claudeEffort(tier);
    case "codex":
      return codexReasoningEffort(tier);
    case "cursor":
      return null;
  }
}

export function resolveTier(runner: RunnerKind, tier: JudgmentTier): TierResolution {
  const model = TIER_TABLE[runner][tier];
  return { model, effort: model === null ? null : effortForTier(runner, tier) };
}

export interface TierRow {
  tier: JudgmentTier;
  runners: Record<RunnerKind, TierResolution>;
}

/** The whole table, for `quirks harness` and the native app. */
export function tierTable(): TierRow[] {
  const runners: RunnerKind[] = ["claude", "codex", "cursor"];
  return TIERS.map((tier) => ({
    tier,
    runners: Object.fromEntries(
      runners.map((runner) => [runner, resolveTier(runner, tier)]),
    ) as Record<RunnerKind, TierResolution>,
  }));
}

export interface ReviewerCandidate {
  runner: RunnerKind;
  tier: JudgmentTier;
  model: string;
}

export type ReviewerSelection =
  | { kind: "independent"; reviewer: ReviewerCandidate; reason: string }
  | { kind: "independence-unavailable"; requiredTier: JudgmentTier; reason: string };

export interface SelectReviewerInput {
  implementer: { runner: RunnerKind; model: string; tier: JudgmentTier };
  /** Runners that are actually usable right now. Order is the tie-breaker. */
  available: readonly RunnerKind[];
  risk?: string;
}

/**
 * Pick a reviewer from a different model family at or above the required tier.
 * v1's rule, kept verbatim in spirit: never invent a route, and never label a
 * same-family fallback independent (v1 src/prompt/model-selection.ts). The
 * caller surfaces `independence-unavailable` to the operator; it must not be
 * silently downgraded into a same-model review.
 */
export function selectIndependentReviewer(input: SelectReviewerInput): ReviewerSelection {
  const requiredTier = requiredTierForRole("reviewer", input.implementer.tier, input.risk);
  // Canonical identity, not family: two names for one model are not independent.
  const implementerId = canonicalModel(input.implementer.model);

  const candidates: ReviewerCandidate[] = [];
  for (const runner of input.available) {
    // At or above the required tier, cheapest qualifying tier first.
    for (const tier of TIERS) {
      if (TIER_RANK[tier] < TIER_RANK[requiredTier]) continue;
      const model = TIER_TABLE[runner][tier];
      if (model === null) continue;
      if (canonicalModel(model) === implementerId) continue;
      candidates.push({ runner, tier, model });
      break;
    }
  }

  const chosen = candidates[0];
  if (!chosen) {
    return {
      kind: "independence-unavailable",
      requiredTier,
      reason:
        `no available harness offers a model other than ${implementerId} at ` +
        `tier ${requiredTier} or above — review cannot be independent ` +
        `(available: ${input.available.join(", ") || "none"})`,
    };
  }
  return {
    kind: "independent",
    reviewer: chosen,
    reason:
      `${chosen.runner}/${chosen.model} (${canonicalModel(chosen.model)}) reviews at ` +
      `${chosen.tier}, independent of implementer ${input.implementer.runner}/${input.implementer.model}`,
  };
}
