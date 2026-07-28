// Test scaffolding shared by the suite. Two rules it enforces by construction:
//   - every ledger a test touches is a fresh temp dir; the committed `.quirks/`
//     is never a test target, and
//   - a failing Effect surfaces its typed error, not a swallowed exit.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem, NodePath, NodeServices } from "@effect/platform-node";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import type * as Path from "effect/Path";
import { Ledger, layer as ledgerLayer, layerAt, Store } from "../store/Store.ts";
import { layerHarness, layerUnrouted, RunRouting, type RunRoutingShape } from "../ops/Routing.ts";
import type { DispatchOutcome, RunnerKind } from "../runner/Types.ts";
import type { ParentDispatchRequest, ParentHooks } from "../run/Parent.ts";

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

/**
 * The ledger without a `ChildProcessSpawner` in sight.
 *
 * This is not a convenience: an effect that runs here provably spawned nothing,
 * which is how QK-HARN-002's "plan assembly executes no harness" is checked
 * rather than asserted. The bun-era suite could only say `availability()` was
 * declared synchronous.
 */
export type NoSpawnServices = Store | Ledger | FileSystem.FileSystem | Path.Path;

export const noSpawnLayer = (root: string): Layer.Layer<NoSpawnServices> =>
  ledgerLayer.pipe(
    Layer.provideMerge(layerAt(root)),
    Layer.provideMerge(Layer.merge(NodeFileSystem.layer, NodePath.layer)),
  );

export const runNoSpawn = <A, E>(
  root: string,
  effect: Effect.Effect<A, E, NoSpawnServices>,
): Promise<A> => Effect.runPromise(Effect.provide(effect, noSpawnLayer(root)));

/** A routing layer with a fixed routable set and a stub tier resolver, so a plan
 *  assertion does not depend on which CLIs the developer happens to have. The
 *  real one (QK-MONO-005) is `layerHarness`, behind this same interface. */
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

/** The REAL routing layer (presence + tier table + liveness), rooted at a temp
 *  ledger. Its own Ledger is built here so the layer can be handed to `runOp`
 *  wherever `stubRouting` would otherwise go. */
export const harnessRouting = (root: string): Layer.Layer<RunRouting> =>
  Layer.provide(
    layerHarness,
    ledgerLayer.pipe(
      Layer.provideMerge(layerAt(root)),
      Layer.provideMerge(Layer.merge(NodeFileSystem.layer, NodePath.layer)),
    ),
  );

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

// ---- run/dispatch fakes ----
//
// Nothing in the suite may spawn a real agent CLI. `ParentHooks.dispatch` is the
// only door to a process, and these fakes are the only thing the run tests put
// behind it — the same discipline the bun-era test/parent.test.ts used, made
// unavoidable by the fact that a fake hook has no `ChildProcessSpawner` to give.

export const dispatched = (
  jobId: string,
  extra: Partial<DispatchOutcome> = {},
): DispatchOutcome => ({
  jobId,
  runner: "claude",
  status: "success",
  exitCode: 0,
  transcriptPath: null,
  durationMs: 1,
  ...extra,
});

export interface FakeHooksOptions {
  readonly implementer?: { readonly runner: RunnerKind; readonly model: string } | undefined;
  readonly reviewer?: { readonly runner: RunnerKind; readonly model: string } | undefined;
  readonly review?: boolean | undefined;
  readonly landingCommit?: string | null | undefined;
  readonly dispatch?: ((req: ParentDispatchRequest) => DispatchOutcome) | undefined;
}

/** Parent hooks whose dispatch is a pure function of the request. */
export const fakeHooks = (options: FakeHooksOptions = {}): ParentHooks => ({
  implementer: options.implementer ?? { runner: "claude", model: "sonnet" },
  ...(options.reviewer ? { reviewer: options.reviewer } : {}),
  review: options.review ?? options.reviewer !== undefined,
  detectLandingCommit: () => options.landingCommit ?? null,
  dispatch: (req) =>
    Effect.sync(() =>
      options.dispatch ? options.dispatch(req) : dispatched(`${req.role}-${req.taskId}`),
    ),
});
