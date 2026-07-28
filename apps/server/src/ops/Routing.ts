// The seam between run planning and the harness machinery.
//
// A plan row names a harness and a model. Deciding *which* one — presence on
// disk, the tier table, liveness derived from the run record — is the honesty
// machinery. QK-MONO-003 shipped the seam rather than a guess; QK-MONO-005
// ported the machinery and filled it with `layerHarness` below, and ops/Runs.ts
// did not change a line to accept it.
//
// This is the same rule the tier table itself follows: a runner with no probed
// model resolves to `unassigned` rather than a guess. Inventing a route would be
// worse than admitting we do not have one.

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { RunnerKind, Task } from "@quirks/contracts";
import { Ledger } from "../store/Store.ts";
import { availability, routeTask, type HarnessRow } from "./Harness.ts";

export interface TaskRouting {
  readonly harness: RunnerKind | "unassigned";
  readonly model: string;
}

export interface RunRoutingShape {
  /** Runners a plan may route to right now, in a fixed preference order.
   *  Fixed rather than "best first" so approving a plan twice yields the same
   *  plan — routing must not flip because a dispatch landed in between. */
  readonly routable: Effect.Effect<readonly RunnerKind[]>;
  /** What a plan row should say for a task, given the routable set. */
  readonly routeTask: (task: Task, routable: readonly RunnerKind[]) => TaskRouting;
  /** Caveats about the harnesses a plan intends to use. Shown above the `[y/N]`;
   *  deliberately not persisted on the Run — they describe the machine now. */
  readonly harnessWarnings: (used: readonly RunnerKind[]) => Effect.Effect<string[]>;
}

export class RunRouting extends Context.Service<RunRouting, RunRoutingShape>()(
  "quirks/RunRouting",
) {}

/** A deliberately harness-blind routing layer: no presence check, no tier table,
 *  no liveness. It is what QK-MONO-003 shipped, and it stays because a caller
 *  that must not touch the machine (a plan assembled for a different host, a
 *  test that fixes its own routable set) still needs a truthful answer. */
export const layerUnrouted: Layer.Layer<RunRouting> = Layer.succeed(RunRouting, {
  routable: Effect.succeed([]),
  routeTask: () => ({ harness: "unassigned", model: "unassigned" }),
  harnessWarnings: () =>
    Effect.succeed([
      "harness routing is not available in this layer: presence, the tier table, and " +
        "liveness ported in QK-MONO-005 and live in ops/Harness.ts, which this layer " +
        "deliberately does not consult. Every plan row is unassigned rather than " +
        "routed to a harness nobody checked.",
    ]),
});

/**
 * The real thing (QK-MONO-005): presence on disk, the tier table, and liveness
 * derived from the run record. Nothing here spawns a process — `availability`
 * requires only `Ledger`, which is what keeps plan assembly free (QK-HARN-002).
 *
 * A ledger it cannot read is the one interesting case. The bun-era plan path
 * propagated the corruption and refused the whole plan; here `routable` cannot
 * fail (the seam's shape forbids it), so it answers with the honest empty set —
 * routing to a harness whose dispatch history we could not read would be a guess
 * — and `harnessWarnings` says so out loud, above the `[y/N]`.
 */
export const layerHarness: Layer.Layer<RunRouting, never, Ledger> = Layer.effect(
  RunRouting,
  Effect.gen(function* () {
    // Captured once so the service's own effects carry no requirements.
    const context = yield* Effect.context<Ledger>();
    const state = availability().pipe(
      Effect.map((a) => ({
        rows: a.rows,
        routable: a.routable,
        unreadable: null as string | null,
      })),
      Effect.catch((error) =>
        Effect.succeed({
          rows: [] as HarnessRow[],
          routable: [] as RunnerKind[],
          unreadable: error.message,
        }),
      ),
      Effect.provideContext(context),
    );

    return {
      routable: Effect.map(state, (s) => s.routable),
      routeTask: (task, routable) => {
        const routed = routeTask(task, routable);
        return { harness: routed.harness, model: routed.model };
      },
      harnessWarnings: (used) =>
        Effect.map(state, (s) => {
          const warnings: string[] = [];
          if (s.unreadable !== null) {
            warnings.push(
              `harness routing could not read the run record, so it refused to route at all: ` +
                `${s.unreadable.split("\n")[0] ?? s.unreadable}`,
            );
          }
          for (const row of s.rows) {
            if (!used.includes(row.runner) || row.lean === "yes") continue;
            warnings.push(`harness ${row.runner}: ${row.leanDetail}`);
          }
          return warnings;
        }),
    } satisfies RunRoutingShape;
  }),
);
