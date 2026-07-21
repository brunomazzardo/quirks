import assert from "node:assert/strict";
import test from "node:test";
import { assertTierCompatible, resolveRoute } from "../../src/campaign/routing.js";
import type { RoutableProfile } from "../../src/campaign/routing.js";

const profiles: RoutableProfile[] = [
  { profileId: "claude-principal", runnerType: "claude", tier: "principal", effort: "principal", quotaPoolId: "pool-a", healthy: true, remainingAllocation: 10 },
  { profileId: "cursor-standard", runnerType: "cursor", tier: "standard", effort: "standard", quotaPoolId: "pool-b", healthy: true, remainingAllocation: 5 },
];

test("requires principal supervision for delegated architecture", () => {
  const route = resolveRoute({ id: "D-1", effort: "principal", risk: ["architecture"] }, profiles, { role: "supervisor" });
  assert.equal(route.profileId, "claude-principal");
});

test("rejects tier downgrades not present in the approved envelope", () => {
  assert.throws(
    () => assertTierCompatible("principal", { tier: "standard", profileId: "cursor-standard", runnerType: "cursor", effort: "standard", quotaPoolId: "pool-b" }),
    /TIER_DOWNGRADE/,
  );
});

test("allows a resolved tier that meets or exceeds the required tier", () => {
  assert.doesNotThrow(() =>
    assertTierCompatible("standard", { tier: "principal", profileId: "claude-principal", runnerType: "claude", effort: "principal", quotaPoolId: "pool-a" }),
  );
});

test("prefers the healthy pool with the most remaining allocation among compatible routes", () => {
  const richer: RoutableProfile[] = [
    { profileId: "codex-standard-a", runnerType: "codex", tier: "standard", effort: "standard", quotaPoolId: "pool-c", healthy: true, remainingAllocation: 2 },
    { profileId: "codex-standard-b", runnerType: "codex", tier: "standard", effort: "standard", quotaPoolId: "pool-d", healthy: true, remainingAllocation: 8 },
  ];
  const route = resolveRoute({ id: "T-1", effort: "standard", risk: [] }, richer, { role: "implementer" });
  assert.equal(route.profileId, "codex-standard-b");
});

test("skips unhealthy pools even when they have more remaining allocation", () => {
  const mixed: RoutableProfile[] = [
    { profileId: "codex-unhealthy", runnerType: "codex", tier: "standard", effort: "standard", quotaPoolId: "pool-e", healthy: false, remainingAllocation: 100 },
    { profileId: "codex-healthy", runnerType: "codex", tier: "standard", effort: "standard", quotaPoolId: "pool-f", healthy: true, remainingAllocation: 1 },
  ];
  const route = resolveRoute({ id: "T-2", effort: "standard", risk: [] }, mixed, { role: "implementer" });
  assert.equal(route.profileId, "codex-healthy");
});

test("throws NO_COMPATIBLE_ROUTE when no profile is healthy at the required tier", () => {
  assert.throws(
    () => resolveRoute({ id: "T-3", effort: "principal", risk: [] }, profiles, { role: "implementer", preferredProfileId: "cursor-standard" }),
    /NO_COMPATIBLE_ROUTE/,
  );
});
