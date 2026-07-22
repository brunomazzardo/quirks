import assert from "node:assert/strict";
import test from "node:test";
import { deriveModelFamily, selectIndependentReviewer } from "../../src/prompt/model-selection.js";
import type { PromptProfileContext } from "../../src/prompt/types.js";
import type { RunnerType } from "../../src/campaign/routing.js";

function profile(
  profileId: string,
  runnerKind: RunnerType,
  model: string,
  tier: PromptProfileContext["tier"] = "principal",
): PromptProfileContext {
  return { profileId, runnerKind, model, modelFamily: deriveModelFamily(model), tier };
}

test("derives a deterministic model family from the model identifier", () => {
  assert.equal(deriveModelFamily("gpt-5.6-sol"), "gpt");
  assert.equal(deriveModelFamily("gpt-5.6-terra"), "gpt");
  assert.equal(deriveModelFamily("opus-4.8"), "opus");
  assert.equal(deriveModelFamily("composer-2.5"), "composer");
});

test("selects a review-capable profile from a different model family", () => {
  const selected = selectIndependentReviewer({
    implementer: profile("codex-gpt-5.6", "codex", "gpt-5.6-sol"),
    requiredTier: "high",
    approved: [
      profile("codex-gpt-5.6-terra", "codex", "gpt-5.6-terra"),
      profile("claude-opus", "claude", "opus-4.8"),
    ],
  });
  assert.equal(selected.kind, "independent");
  if (selected.kind !== "independent") return;
  assert.equal(selected.profile.profileId, "claude-opus");
});

test("reports independence-unavailable when only the implementer family qualifies", () => {
  const selected = selectIndependentReviewer({
    implementer: profile("codex-gpt-5.6", "codex", "gpt-5.6-sol"),
    requiredTier: "high",
    approved: [
      profile("codex-gpt-5.6", "codex", "gpt-5.6-sol"),
      profile("codex-gpt-5.6-terra", "codex", "gpt-5.6-terra"),
    ],
  });
  assert.equal(selected.kind, "independence-unavailable");
  if (selected.kind !== "independence-unavailable") return;
  assert.match(selected.reason, /family/i);
});

test("excludes different-family profiles below the required review tier", () => {
  const selected = selectIndependentReviewer({
    implementer: profile("codex-gpt-5.6", "codex", "gpt-5.6-sol"),
    requiredTier: "high",
    approved: [
      profile("claude-haiku", "claude", "haiku-4", "standard"),
      profile("cursor-composer", "cursor", "composer-2.5", "high"),
    ],
  });
  assert.equal(selected.kind, "independent");
  if (selected.kind !== "independent") return;
  assert.equal(selected.profile.profileId, "cursor-composer");
});

test("preserves approved-profile order as the deterministic tie-breaker", () => {
  const selected = selectIndependentReviewer({
    implementer: profile("codex-gpt-5.6", "codex", "gpt-5.6-sol"),
    requiredTier: "high",
    approved: [
      profile("claude-opus", "claude", "opus-4.8"),
      profile("cursor-composer", "cursor", "composer-2.5"),
    ],
  });
  assert.equal(selected.kind, "independent");
  if (selected.kind !== "independent") return;
  assert.equal(selected.profile.profileId, "claude-opus");
});

test("never selects the implementer profile even when listed as approved", () => {
  const implementer = profile("codex-gpt-5.6", "codex", "gpt-5.6-sol");
  const selected = selectIndependentReviewer({
    implementer,
    requiredTier: "high",
    approved: [implementer],
  });
  assert.equal(selected.kind, "independence-unavailable");
});
