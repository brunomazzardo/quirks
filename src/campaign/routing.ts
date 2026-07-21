import { QuirksError } from "../core/errors.js";
import type { JudgmentTier } from "./types.js";

export type RunnerType = "claude" | "codex" | "cursor";

export interface RoutableProfile {
  profileId: string;
  runnerType: RunnerType;
  tier: JudgmentTier;
  effort: JudgmentTier;
  quotaPoolId: string;
  healthy: boolean;
  remainingAllocation: number;
}

export interface ResolvedRoute {
  profileId: string;
  runnerType: RunnerType;
  tier: JudgmentTier;
  effort: JudgmentTier;
  quotaPoolId: string;
}

const TIER_RANK: Record<JudgmentTier, number> = {
  mechanical: 0,
  standard: 1,
  high: 2,
  principal: 3,
};

const JUDGMENT_HEAVY_RISKS = new Set([
  "architecture",
  "security",
  "identity",
  "concurrency",
  "protocol",
  "production",
  "destructive-migration",
]);

export function tierAbove(tier: JudgmentTier): JudgmentTier {
  switch (tier) {
    case "mechanical": return "standard";
    case "standard": return "high";
    case "high": return "principal";
    case "principal": return "principal";
  }
}

function higherTier(left: JudgmentTier, right: JudgmentTier): JudgmentTier {
  return TIER_RANK[left] >= TIER_RANK[right] ? left : right;
}

export function requiredTierForRole(
  role: "supervisor" | "implementer" | "reviewer",
  effort: JudgmentTier,
  risk: readonly string[],
): JudgmentTier {
  if (role === "supervisor") return "principal";
  if (role === "implementer") return effort;
  const elevated = tierAbove(effort);
  return risk.some((entry) => JUDGMENT_HEAVY_RISKS.has(entry)) ? higherTier(elevated, "high") : elevated;
}

export function assertTierCompatible(required: JudgmentTier, resolved: ResolvedRoute | { tier: JudgmentTier; profileId: string }): void {
  if (TIER_RANK[resolved.tier] < TIER_RANK[required]) {
    throw new QuirksError("PROTOCOL_VIOLATION", "TIER_DOWNGRADE", { required, resolved: resolved.tier, profileId: resolved.profileId });
  }
}

export function resolveRoute(
  task: { id: string; effort: JudgmentTier; risk: readonly string[] },
  profiles: readonly RoutableProfile[],
  options: { role: "supervisor" | "implementer" | "reviewer"; preferredProfileId?: string; implementerRunnerType?: RunnerType },
): ResolvedRoute {
  const required = requiredTierForRole(options.role, task.effort, task.risk);
  const compatible = profiles
    .filter((profile) => profile.healthy && TIER_RANK[profile.tier] >= TIER_RANK[required])
    .toSorted((left, right) => right.remainingAllocation - left.remainingAllocation);
  let chosen: RoutableProfile | undefined;
  if (options.preferredProfileId) {
    chosen = compatible.find((profile) => profile.profileId === options.preferredProfileId);
  } else if (options.implementerRunnerType) {
    const crossVendor = compatible.filter((profile) => profile.runnerType !== options.implementerRunnerType);
    chosen = crossVendor[0] ?? compatible[0];
  } else {
    chosen = compatible[0];
  }
  if (!chosen) throw new QuirksError("PROTOCOL_VIOLATION", "NO_COMPATIBLE_ROUTE", { taskId: task.id, required });
  return {
    profileId: chosen.profileId,
    runnerType: chosen.runnerType,
    tier: chosen.tier,
    effort: chosen.effort,
    quotaPoolId: chosen.quotaPoolId,
  };
}
