// QK-HARN-001 — the tier ladder, the model table, and review independence.
// The load-bearing properties: an unprobed model is null rather than invented,
// and a reviewer that is the same model under another name is never labelled
// independent (canonicalModel, QK-HARN-003).
import { describe, expect, test } from "bun:test";
import {
  TIER_TABLE,
  TIERS,
  canonicalModel,
  deriveModelFamily,
  effortForTier,
  isJudgmentHeavy,
  isTier,
  requiredTierForRole,
  resolveTier,
  selectIndependentReviewer,
  tierAbove,
  tierForEffort,
  tierTable,
} from "../src/harness/tiers.ts";
import { defaultRouting } from "../src/run/hooks.ts";

describe("the tier ladder", () => {
  test("steps up and saturates at principal", () => {
    expect(tierAbove("mechanical")).toBe("standard");
    expect(tierAbove("standard")).toBe("high");
    expect(tierAbove("high")).toBe("principal");
    // Nothing above principal — this is why review independence there needs
    // another vendor, not another tier.
    expect(tierAbove("principal")).toBe("principal");
  });

  test("isTier gates the four names and nothing else", () => {
    for (const t of TIERS) expect(isTier(t)).toBe(true);
    expect(isTier("xhigh")).toBe(false);
    expect(isTier("")).toBe(false);
  });

  test("free-text effort falls to standard, never upward", () => {
    expect(tierForEffort("high")).toBe("high");
    expect(tierForEffort("principal")).toBe("principal");
    expect(tierForEffort(undefined)).toBe("standard");
    // A task saying something we do not recognise must not buy a better model.
    expect(tierForEffort("very hard honestly")).toBe("standard");
    expect(tierForEffort("PRINCIPAL")).toBe("standard");
  });
});

describe("requiredTierForRole (ported from v1 routing.ts)", () => {
  test("a supervisor always holds the top tier", () => {
    expect(requiredTierForRole("supervisor", "mechanical")).toBe("principal");
    expect(requiredTierForRole("supervisor", "principal")).toBe("principal");
  });

  test("an implementer works at its own effort", () => {
    expect(requiredTierForRole("implementer", "mechanical")).toBe("mechanical");
    expect(requiredTierForRole("implementer", "high")).toBe("high");
  });

  test("a reviewer sits one tier above the implementer", () => {
    expect(requiredTierForRole("reviewer", "mechanical")).toBe("standard");
    expect(requiredTierForRole("reviewer", "standard")).toBe("high");
    expect(requiredTierForRole("reviewer", "principal")).toBe("principal");
  });

  test("judgment-heavy risk floors the reviewer at high", () => {
    // mechanical would elevate only to standard; the risk overrides that.
    expect(requiredTierForRole("reviewer", "mechanical", "security boundary")).toBe("high");
    expect(requiredTierForRole("reviewer", "mechanical", "concurrency")).toBe("high");
    // It is a floor, not a cap — an already-higher tier is preserved.
    expect(requiredTierForRole("reviewer", "high", "architecture")).toBe("principal");
    // Ordinary risk does not trigger it.
    expect(requiredTierForRole("reviewer", "mechanical", "might be fiddly")).toBe("standard");
  });

  test("judgment-heavy detection reads free text and tolerates absence", () => {
    expect(isJudgmentHeavy(undefined)).toBe(false);
    expect(isJudgmentHeavy("")).toBe(false);
    expect(isJudgmentHeavy("touches Production data")).toBe(true);
    expect(isJudgmentHeavy("cosmetic")).toBe(false);
  });
});

describe("deriveModelFamily", () => {
  test("variants of one family share it", () => {
    expect(deriveModelFamily("gpt-5.6-sol")).toBe("gpt");
    expect(deriveModelFamily("gpt-5.6-terra")).toBe("gpt");
    expect(deriveModelFamily("gpt-5.5")).toBe("gpt");
  });

  test("distinct families stay distinct", () => {
    expect(deriveModelFamily("opus")).toBe("opus");
    expect(deriveModelFamily("sonnet")).toBe("sonnet");
    expect(deriveModelFamily("composer-2.5")).toBe("composer");
    expect(deriveModelFamily("haiku")).toBe("haiku");
  });

  test("trims and lowercases", () => {
    expect(deriveModelFamily("  Opus  ")).toBe("opus");
  });
});

describe("canonicalModel — independence that cannot be faked", () => {
  test("an alias and the full id are ONE identity", () => {
    // The hole this closes: `opus` derives family "opus" while cursor's
    // `claude-opus-5-thinking-high` derives "claude" — two names, one model.
    expect(canonicalModel("opus")).toBe("claude-opus-5");
    expect(canonicalModel("claude-opus-5")).toBe("claude-opus-5");
    expect(canonicalModel("claude-opus-5-thinking-high")).toBe("claude-opus-5");
    expect(canonicalModel("claude-opus-5-low")).toBe("claude-opus-5");
  });

  test("longest match wins, so 4-8 never resolves via a shorter sibling", () => {
    expect(canonicalModel("claude-opus-4-8-thinking-high")).toBe("claude-opus-4-8");
    expect(canonicalModel("claude-opus-4-8")).not.toBe(canonicalModel("claude-opus-5"));
  });

  test("different models stay different — not collapsed to the vendor", () => {
    // FOUNDING says a reviewer on a different MODEL, so sonnet reviewing opus
    // must remain independent; collapsing both to "claude" would delete review
    // from the default path entirely.
    expect(canonicalModel("sonnet")).toBe("claude-sonnet-5");
    expect(canonicalModel("haiku")).toBe("claude-haiku-4-5");
    expect(canonicalModel("sonnet")).not.toBe(canonicalModel("opus"));
  });

  test("unrecognized ids fall back to the family rather than throwing", () => {
    expect(canonicalModel("composer-2.5")).toBe("composer");
    expect(canonicalModel("gpt-5.6-sol")).toBe("gpt");
    expect(canonicalModel("  OPUS  ")).toBe("claude-opus-5");
  });

  test("THE guard: a decorated id is refused a reviewer that is the same model", () => {
    // An implementer running one of cursor's claude rungs — 88 of its 193
    // published models are claude-* — asks for review. claude's own high and
    // principal rungs are both `opus`, which IS this model under another name.
    // Family comparison called that independent; canonical identity does not.
    const selection = selectIndependentReviewer({
      implementer: { runner: "cursor", model: "claude-opus-5-thinking-high", tier: "standard" },
      available: ["claude"],
    });
    expect(selection.kind).toBe("independence-unavailable");
    if (selection.kind !== "independence-unavailable") throw new Error("unreachable");
    expect(selection.reason).toContain("claude-opus-5");

    // Proof this is the canonicalization and not an unrelated refusal: under the
    // old family rule, "claude" vs "opus" differed and this returned independent.
    expect(deriveModelFamily("claude-opus-5-thinking-high")).not.toBe(deriveModelFamily("opus"));
    expect(canonicalModel("claude-opus-5-thinking-high")).toBe(canonicalModel("opus"));
  });

  test("a genuinely different model still reviews it", () => {
    // Same implementer, but codex is available — gpt is a real other model.
    const selection = selectIndependentReviewer({
      implementer: { runner: "cursor", model: "claude-opus-5-thinking-high", tier: "standard" },
      available: ["claude", "codex"],
    });
    expect(selection.kind).toBe("independent");
    if (selection.kind !== "independent") throw new Error("unreachable");
    expect(selection.reviewer.runner).toBe("codex");
  });
});

describe("the model table invents nothing", () => {
  test("a tier with no probed model is null, not a plausible string", () => {
    // codex: no mechanical-tier model was ever probed
    // (docs/evidence/runner-boundary-probe.md). cursor: composer-2.5 publishes no
    // tier ladder at all, and the full ladders on offer were rejected to keep
    // three distinct model identities. Either way the cell says so.
    expect(TIER_TABLE.codex.mechanical).toBeNull();
    expect(TIER_TABLE.cursor.mechanical).toBeNull();
    expect(resolveTier("codex", "mechanical")).toEqual({ model: null, effort: null });
  });

  test("every non-null model is one the evidence actually exercised", () => {
    const probed = new Set([
      "sonnet",
      "opus",
      "haiku",
      "gpt-5.5",
      "gpt-5.6-terra",
      "gpt-5.6-sol",
      "composer-2.5",
    ]);
    for (const row of tierTable()) {
      for (const resolution of Object.values(row.runners)) {
        if (resolution.model !== null) expect(probed.has(resolution.model)).toBe(true);
      }
    }
  });

  test("effort is the runner's own flag, and cursor has none", () => {
    expect(effortForTier("claude", "mechanical")).toBe("low");
    expect(effortForTier("claude", "standard")).toBe("medium");
    expect(effortForTier("claude", "principal")).toBe("xhigh");
    // codex saturates at high — it has no xhigh.
    expect(effortForTier("codex", "principal")).toBe("high");
    // cursor-agent exposes no effort flag at all; do not pretend otherwise.
    expect(effortForTier("cursor", "high")).toBeNull();
    expect(resolveTier("cursor", "high").effort).toBeNull();
  });

  test("the table covers every tier for every runner", () => {
    const rows = tierTable();
    expect(rows.map((r) => r.tier)).toEqual([...TIERS]);
    for (const row of rows) {
      expect(Object.keys(row.runners).sort()).toEqual(["claude", "codex", "cursor"]);
    }
  });
});

describe("selectIndependentReviewer", () => {
  test("picks a different family at or above the required tier", () => {
    const selection = selectIndependentReviewer({
      implementer: { runner: "claude", model: "sonnet", tier: "standard" },
      available: ["claude"],
    });
    expect(selection.kind).toBe("independent");
    if (selection.kind !== "independent") throw new Error("unreachable");
    // reviewer tier for a standard implementer is high → claude/opus.
    expect(selection.reviewer).toEqual({ runner: "claude", tier: "high", model: "opus" });
    expect(canonicalModel(selection.reviewer.model)).not.toBe(canonicalModel("sonnet"));
  });

  test("never returns the implementer's own family", () => {
    // A principal claude implementer is on `opus`, and the tier above is still
    // `opus` — within claude there is no independent reviewer.
    const selection = selectIndependentReviewer({
      implementer: { runner: "claude", model: "opus", tier: "principal" },
      available: ["claude"],
    });
    expect(selection.kind).toBe("independence-unavailable");
    if (selection.kind !== "independence-unavailable") throw new Error("unreachable");
    expect(selection.requiredTier).toBe("principal");
    expect(selection.reason).toContain("claude-opus-5");
    expect(selection.reason).toContain("cannot be independent");
  });

  test("crosses vendor when the same runner cannot be independent", () => {
    const selection = selectIndependentReviewer({
      implementer: { runner: "claude", model: "opus", tier: "principal" },
      available: ["claude", "codex"],
    });
    expect(selection.kind).toBe("independent");
    if (selection.kind !== "independent") throw new Error("unreachable");
    expect(selection.reviewer.runner).toBe("codex");
    expect(selection.reviewer.model).toBe("gpt-5.6-sol");
  });

  test("no available harness means unavailable, with the reason and the tier", () => {
    const selection = selectIndependentReviewer({
      implementer: { runner: "claude", model: "sonnet", tier: "standard" },
      available: [],
    });
    expect(selection.kind).toBe("independence-unavailable");
    if (selection.kind !== "independence-unavailable") throw new Error("unreachable");
    expect(selection.requiredTier).toBe("high");
    expect(selection.reason).toContain("none");
  });

  test("skips runners with no model at the required tier", () => {
    // cursor has no mechanical model; a mechanical implementer needs standard
    // review, which cursor does serve.
    const selection = selectIndependentReviewer({
      implementer: { runner: "claude", model: "haiku", tier: "mechanical" },
      available: ["cursor"],
    });
    expect(selection.kind).toBe("independent");
    if (selection.kind !== "independent") throw new Error("unreachable");
    expect(selection.reviewer).toEqual({
      runner: "cursor",
      tier: "standard",
      model: "composer-2.5",
    });
  });

  test("defaultRouting turns the table into implementer + independent reviewer", () => {
    const routing = defaultRouting();
    expect(routing.implementer).toEqual({
      runner: "claude",
      model: "sonnet",
      effort: "medium",
    });
    expect(routing.reviewer).toEqual({ runner: "claude", model: "opus", effort: "high" });
    expect(routing.reviewNote).toContain("independent of implementer");
  });

  test("defaultRouting yields NO reviewer rather than a same-model one", () => {
    // A principal claude implementer with only claude available cannot be
    // reviewed independently — so the run goes unreviewed, and says why.
    const routing = defaultRouting("principal", ["claude"]);
    expect(routing.implementer.model).toBe("opus");
    expect(routing.reviewer).toBeUndefined();
    expect(routing.reviewNote).toContain("cannot be independent");
  });

  test("defaultRouting crosses vendor when that is what independence needs", () => {
    const routing = defaultRouting("principal", ["claude", "codex"]);
    expect(routing.reviewer).toEqual({
      runner: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
    });
  });

  test("defaultRouting refuses a tier the chosen runner has no model for", () => {
    // cursor has no mechanical model; inventing one is the failure mode.
    expect(() => defaultRouting("mechanical", ["cursor"])).toThrow(/no probed model/);
  });

  test("available order is the tie-breaker", () => {
    const codexFirst = selectIndependentReviewer({
      implementer: { runner: "claude", model: "opus", tier: "principal" },
      available: ["codex", "cursor"],
    });
    const cursorFirst = selectIndependentReviewer({
      implementer: { runner: "claude", model: "opus", tier: "principal" },
      available: ["cursor", "codex"],
    });
    if (codexFirst.kind !== "independent" || cursorFirst.kind !== "independent") {
      throw new Error("unreachable");
    }
    expect(codexFirst.reviewer.runner).toBe("codex");
    expect(cursorFirst.reviewer.runner).toBe("cursor");
  });
});
