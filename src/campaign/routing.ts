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

export function assertTierCompatible(required: JudgmentTier, resolved: ResolvedRoute | { tier: JudgmentTier; profileId: string }): void {
  if (TIER_RANK[resolved.tier] < TIER_RANK[required]) {
    throw new QuirksError("PROTOCOL_VIOLATION", "TIER_DOWNGRADE", { required, resolved: resolved.tier, profileId: resolved.profileId });
  }
}

export function resolveRoute(
  task: { id: string; effort: JudgmentTier; risk: readonly string[] },
  profiles: readonly RoutableProfile[],
  options: { role: "supervisor" | "implementer" | "reviewer"; preferredProfileId?: string },
): ResolvedRoute {
  const required: JudgmentTier = options.role === "supervisor" ? "principal" : task.effort;
  const compatible = profiles
    .filter((profile) => profile.healthy && TIER_RANK[profile.tier] >= TIER_RANK[required])
    .toSorted((left, right) => right.remainingAllocation - left.remainingAllocation);
  const chosen = options.preferredProfileId
    ? compatible.find((profile) => profile.profileId === options.preferredProfileId)
    : compatible[0];
  if (!chosen) throw new QuirksError("PROTOCOL_VIOLATION", "NO_COMPATIBLE_ROUTE", { taskId: task.id, required });
  return {
    profileId: chosen.profileId,
    runnerType: chosen.runnerType,
    tier: chosen.tier,
    effort: chosen.effort,
    quotaPoolId: chosen.quotaPoolId,
  };
}
