// Test scaffolding shared by the suite. Two rules it enforces by construction:
//   - every ledger a test touches is a fresh temp dir; the committed `.quirks/`
//     is never a test target, and
//   - a failing Effect surfaces its typed error, not a swallowed exit.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Ledger, layer as ledgerLayer, layerAt, Store } from "../store/Store.ts";
import { layerUnrouted, RunRouting, type RunRoutingShape } from "../ops/Routing.ts";

/** A throwaway ledger root. Never the repo's own `.quirks/`. */
export function tempRoot(prefix = "quirks-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export type OpServices = Store | Ledger | RunRouting | NodeServices.NodeServices;

export const opLayer = (
  root: string,
  routing: Layer.Layer<RunRouting> = layerUnrouted,
): Layer.Layer<OpServices> =>
  Layer.mergeAll(ledgerLayer, routing).pipe(
    Layer.provideMerge(layerAt(root)),
    Layer.provideMerge(NodeServices.layer),
  );

/** A routing layer with a fixed routable set and a stub tier resolver, so a plan
 *  assertion does not depend on which CLIs the developer happens to have.
 *  QK-MONO-005 replaces the real thing behind the same interface. */
export const stubRouting = (
  routable: readonly ("claude" | "codex" | "cursor")[],
  models: Readonly<Record<string, string | null>> = {
    claude: "sonnet",
    codex: "gpt-5.5",
    cursor: "composer-2.5",
  },
): Layer.Layer<RunRouting> =>
  Layer.succeed(RunRouting, {
    routable: Effect.succeed(routable),
    routeTask: (_task, available) => {
      for (const runner of available) {
        const model = models[runner];
        if (model != null) return { harness: runner, model };
      }
      return { harness: "unassigned", model: "unassigned" };
    },
    harnessWarnings: (used) =>
      Effect.succeed(used.map((runner) => `harness ${runner}: no run has dispatched to it yet`)),
  } satisfies RunRoutingShape);

/** Run an op against a temp-rooted ledger. */
export const runOp = <A, E>(
  root: string,
  effect: Effect.Effect<A, E, OpServices>,
  routing?: Layer.Layer<RunRouting>,
): Promise<A> => Effect.runPromise(Effect.provide(effect, opLayer(root, routing)));

/** Run an op that is expected to fail, and hand back the typed error. Succeeding
 *  is itself a failure — a refusal that stops refusing is the defect. */
export const runOpError = <A, E>(
  root: string,
  effect: Effect.Effect<A, E, OpServices>,
  routing?: Layer.Layer<RunRouting>,
): Promise<E> => runOp(root, Effect.flip(effect), routing);

/** Run something that only needs the platform (filesystem/path) services. */
export const runPlatform = <A, E>(
  effect: Effect.Effect<A, E, NodeServices.NodeServices>,
): Promise<A> => Effect.runPromise(Effect.provide(effect, NodeServices.layer));

export const runPlatformError = <A, E>(
  effect: Effect.Effect<A, E, NodeServices.NodeServices>,
): Promise<E> => runPlatform(Effect.flip(effect));
