// The seam QK-MONO-003 left, now filled (QK-MONO-005).
//
// What is checked here is the JOIN: that plan assembly reaches the real tier
// table and the real presence/liveness answer without ops/Runs.ts knowing any of
// it. Presence itself is machine-dependent, so every assertion below is either
// pure (the tier table) or about a fact this test creates (a corrupt ledger).
import { writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";
import { RunRouting } from "./Routing.ts";
import { assemblePlan } from "./Runs.ts";
import { createGoal } from "./Goals.ts";
import { proposeTask, type ProposeInput } from "./Tasks.ts";
import { harnessRouting, runOp, tempRoot } from "../testing/Harness.ts";

const propose = (overrides: Partial<ProposeInput> & { title: string }): ProposeInput => ({
  dependsOn: [],
  deliverables: [],
  criteria: [],
  verify: [],
  sources: [],
  needsDesign: false,
  needsBreakdown: false,
  future: false,
  ...overrides,
});

const seed = Effect.gen(function* () {
  yield* createGoal({ id: "QK-RT", title: "routing", why: "w", doneWhen: ["done"] });
  yield* proposeTask(propose({ title: "standard work", goal: "QK-RT" }));
  yield* proposeTask(propose({ title: "deep work", goal: "QK-RT", effort: "principal" }));
});

describe("layerHarness — the real routing layer", () => {
  it("routes plan rows through the tier table, and ops/Runs.ts never learns how", async () => {
    const root = tempRoot("quirks-routing-");
    const plan = await runOp(
      root,
      Effect.gen(function* () {
        yield* seed;
        // `routable` is injected so the assertion does not depend on which CLIs
        // the developer happens to have; the MODELS come from the real table.
        return yield* assemblePlan({ name: "routed", goal: "QK-RT", routable: ["claude"] });
      }),
      harnessRouting(root),
    );
    expect(plan.plan.map((p) => [p.harness, p.model])).toEqual([
      ["claude", "sonnet"],
      ["claude", "opus"],
    ]);
  });

  it("falls to unassigned rather than inventing a route for a tier nobody serves", async () => {
    const root = tempRoot("quirks-routing-");
    const plan = await runOp(
      root,
      Effect.gen(function* () {
        yield* createGoal({ id: "QK-RT", title: "routing", why: "w", doneWhen: ["done"] });
        yield* proposeTask(propose({ title: "tiny", goal: "QK-RT", effort: "mechanical" }));
        // cursor publishes no mechanical rung, and pretending otherwise is the
        // failure mode this whole table exists to avoid.
        return yield* assemblePlan({ name: "nowhere", goal: "QK-RT", routable: ["cursor"] });
      }),
      harnessRouting(root),
    );
    expect(plan.plan[0]?.harness).toBe("unassigned");
    expect(plan.warnings.some((w) => w.includes("will not dispatch"))).toBe(true);
  });

  it("warns about a harness the plan intends to use but cannot vouch for", async () => {
    const root = tempRoot("quirks-routing-");
    const plan = await runOp(
      root,
      Effect.gen(function* () {
        yield* seed;
        return yield* assemblePlan({ name: "warned", goal: "QK-RT", routable: ["claude"] });
      }),
      harnessRouting(root),
    );
    // The ledger is empty, so nothing has ever been dispatched: claude can be
    // "unproven" (installed here) or "no" (absent here), but it can never be the
    // "yes" that would suppress the warning.
    expect(plan.warnings.some((w) => w.startsWith("harness claude:"))).toBe(true);
  });

  it("routable order is fixed, whatever this machine has installed", async () => {
    const root = tempRoot("quirks-routing-");
    const routable = await runOp(
      root,
      Effect.gen(function* () {
        const routing = yield* RunRouting;
        return yield* routing.routable;
      }),
      harnessRouting(root),
    );
    expect(routable).toEqual(
      ["claude", "codex", "cursor"].filter((r) => routable.includes(r as never)),
    );
  });

  it("a run record it cannot read means no routing at all, said out loud", async () => {
    // The bun-era plan path let the corruption escape and refused the whole plan.
    // The seam's shape forbids a failure here, so the layer answers with the
    // honest empty set instead — and the warning above the [y/N] carries the
    // reason, rather than an unexplained page of `unassigned`.
    const root = tempRoot("quirks-routing-");
    mkdirSync(join(root, ".quirks"), { recursive: true });
    writeFileSync(join(root, ".quirks", "runs.json"), "{ torn");

    const result = await runOp(
      root,
      Effect.gen(function* () {
        const routing = yield* RunRouting;
        return {
          routable: yield* routing.routable,
          warnings: yield* routing.harnessWarnings(["claude"]),
        };
      }),
      harnessRouting(root),
    );
    expect(result.routable).toEqual([]);
    expect(result.warnings.some((w) => w.includes("could not read the run record"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("corrupt store file"))).toBe(true);
  });
});
