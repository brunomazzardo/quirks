// The seam between run planning and the harness machinery.
//
// A plan row names a harness and a model. Deciding *which* one — presence on
// disk, the tier table, liveness derived from the run record — is the honesty
// machinery, and it ports in QK-MONO-005 (its ledger deliverable is literally
// "harness and model tables ported"; GET /v1/harness answers 501 until then).
//
// So this build ships the seam, not a guess. `RunRouting` is the service run
// planning consults; the default layer here has no harness knowledge and says
// so, out loud, in the plan warnings. QK-MONO-005 provides the real layer and
// nothing in ops/Runs.ts changes.
//
// This is the same rule the tier table itself follows: a runner with no probed
// model resolves to `unassigned` rather than a guess. Inventing a route would be
// worse than admitting we do not have one.

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { RunnerKind, Task } from "@quirks/contracts";

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

/** The honest default for QK-MONO-003: no harness knowledge, and it says so. */
export const layerUnrouted: Layer.Layer<RunRouting> = Layer.succeed(RunRouting, {
  routable: Effect.succeed([]),
  routeTask: () => ({ harness: "unassigned", model: "unassigned" }),
  harnessWarnings: () =>
    Effect.succeed([
      "harness routing is not available in this build: presence, the tier table, and " +
        "liveness port in QK-MONO-005 (GET /v1/harness answers 501 until then). " +
        "Every plan row is unassigned rather than routed to a harness nobody checked.",
    ]),
});
