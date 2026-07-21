import assert from "node:assert/strict";
import test from "node:test";
import { assertTierCompatible, requiredTierForRole, resolveRoute } from "../../src/campaign/routing.js";
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

test("requiredTierForRole elevates reviewers one tier above implementer effort", () => {
  assert.equal(requiredTierForRole("supervisor", "mechanical", []), "principal");
  assert.equal(requiredTierForRole("implementer", "standard", []), "standard");
  assert.equal(requiredTierForRole("reviewer", "mechanical", []), "standard");
  assert.equal(requiredTierForRole("reviewer", "standard", []), "high");
  assert.equal(requiredTierForRole("reviewer", "high", []), "principal");
  assert.equal(requiredTierForRole("reviewer", "principal", []), "principal");
});

test("requiredTierForRole floors reviewers at high for judgment-heavy risk", () => {
  assert.equal(requiredTierForRole("reviewer", "mechanical", ["security"]), "high");
  assert.equal(requiredTierForRole("reviewer", "mechanical", ["identity", "concurrency"]), "high");
  assert.equal(requiredTierForRole("reviewer", "high", ["production"]), "principal");
  assert.equal(requiredTierForRole("reviewer", "mechanical", ["unrelated-risk"]), "standard");
});

test("resolveRoute rejects reviewer routing at the implementer's own tier", () => {
  const standardOnly: RoutableProfile[] = [
    { profileId: "claude-standard", runnerType: "claude", tier: "standard", effort: "standard", quotaPoolId: "pool-g", healthy: true, remainingAllocation: 5 },
  ];
  assert.throws(
    () => resolveRoute({ id: "R-1", effort: "standard", risk: [] }, standardOnly, { role: "reviewer" }),
    /NO_COMPATIBLE_ROUTE/,
  );
});

test("resolveRoute elevates reviewer routing to a tier above the implementer effort", () => {
  const withHigh: RoutableProfile[] = [
    { profileId: "claude-standard", runnerType: "claude", tier: "standard", effort: "standard", quotaPoolId: "pool-g", healthy: true, remainingAllocation: 5 },
    { profileId: "claude-high", runnerType: "claude", tier: "high", effort: "high", quotaPoolId: "pool-h", healthy: true, remainingAllocation: 5 },
  ];
  const route = resolveRoute({ id: "R-1", effort: "standard", risk: [] }, withHigh, { role: "reviewer" });
  assert.equal(route.profileId, "claude-high");
});

test("resolveRoute keeps principal as the ceiling for reviewer elevation", () => {
  const route = resolveRoute({ id: "R-2", effort: "principal", risk: [] }, profiles, { role: "reviewer" });
  assert.equal(route.profileId, "claude-principal");
});

test("resolveRoute floors reviewer routing at high for judgment-heavy risk", () => {
  const mixedTiers: RoutableProfile[] = [
    { profileId: "claude-standard", runnerType: "claude", tier: "standard", effort: "standard", quotaPoolId: "pool-g", healthy: true, remainingAllocation: 5 },
    { profileId: "claude-high", runnerType: "claude", tier: "high", effort: "high", quotaPoolId: "pool-h", healthy: true, remainingAllocation: 5 },
  ];
  const route = resolveRoute({ id: "R-3", effort: "mechanical", risk: ["security"] }, mixedTiers, { role: "reviewer" });
  assert.equal(route.profileId, "claude-high");
});

test("resolveRoute does not silently downgrade an under-tiered preferred reviewer profile", () => {
  const standardOnly: RoutableProfile[] = [
    { profileId: "claude-standard", runnerType: "claude", tier: "standard", effort: "standard", quotaPoolId: "pool-g", healthy: true, remainingAllocation: 5 },
  ];
  assert.throws(
    () => resolveRoute({ id: "R-4", effort: "standard", risk: [] }, standardOnly, { role: "reviewer", preferredProfileId: "claude-standard" }),
    /NO_COMPATIBLE_ROUTE/,
  );
});

test("resolveRoute prefers a cross-vendor profile over the implementer's own runner type", () => {
  const crossVendorProfiles: RoutableProfile[] = [
    { profileId: "claude-high-a", runnerType: "claude", tier: "high", effort: "high", quotaPoolId: "pool-i", healthy: true, remainingAllocation: 10 },
    { profileId: "codex-high-b", runnerType: "codex", tier: "high", effort: "high", quotaPoolId: "pool-j", healthy: true, remainingAllocation: 3 },
  ];
  const route = resolveRoute({ id: "R-5", effort: "standard", risk: [] }, crossVendorProfiles, { role: "reviewer", implementerRunnerType: "claude" });
  assert.equal(route.profileId, "codex-high-b");
});

test("resolveRoute falls back to the best healthy pool when no cross-vendor profile is compatible", () => {
  const sameVendorOnly: RoutableProfile[] = [
    { profileId: "claude-high-a", runnerType: "claude", tier: "high", effort: "high", quotaPoolId: "pool-k", healthy: true, remainingAllocation: 10 },
    { profileId: "claude-high-b", runnerType: "claude", tier: "high", effort: "high", quotaPoolId: "pool-l", healthy: true, remainingAllocation: 3 },
  ];
  const route = resolveRoute({ id: "R-6", effort: "standard", risk: [] }, sameVendorOnly, { role: "reviewer", implementerRunnerType: "claude" });
  assert.equal(route.profileId, "claude-high-a");
});
