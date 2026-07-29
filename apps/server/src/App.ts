// The service, assembled: the ledger services, the routing seam, the /v1 route
// surface, and the built workbench behind one layer. `toWebHandler` gives tests
// an in-process `fetch`; `dev.ts` serves the same layer over a socket.

import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/unstable/http";
import { codeIdentity, type CodeIdentity } from "@quirks/shared";
import { NodeServices } from "@effect/platform-node";
import { Ledger, layer as ledgerLayer, layerAt, layerFromCwd, Store } from "./store/Store.ts";
import { layerHarness, RunRouting } from "./ops/Routing.ts";
import { runsInFlight } from "./ops/Runs.ts";
import { routes } from "./http/Routes.ts";
import { rendererRoutes } from "./http/Renderer.ts";
import { layer as ptyLayer, PtySessions } from "./pty/Sessions.ts";
import { routes as ptyRoutes } from "./pty/Routes.ts";
import { json, respond } from "./http/Wire.ts";

export const VERSION = "0.1.0";

/**
 * The code THIS process compiled at startup, captured once — after this point
 * edits to src/ cannot change what this process runs, which is the whole
 * problem QK-SRV-006 exists to make visible.
 *
 * `fileURLToPath`, not `URL.pathname`: a repo checked out under a path with a
 * space yields `%20` from `pathname`, the directory walk fails, and the identity
 * silently degrades to the *executable* fingerprint — which the CLI, measuring
 * the same tree successfully, would then read as drift and warn about forever.
 * Exported so the daemon record and `/health` cannot disagree about them.
 */
export const PROCESS_CODE: CodeIdentity = codeIdentity(
  fileURLToPath(new URL(".", import.meta.url)),
);
export const PROCESS_STARTED_AT: string = new Date().toISOString();
const code = PROCESS_CODE;
const startedAt = PROCESS_STARTED_AT;

/**
 * /health confirms an attach reached the right service: id, version, and the
 * ROOT it serves. `runsInFlight` refuses to claim the coast is clear when the
 * runs file is unreadable — a corrupt record is not evidence that nothing runs.
 */
const healthRoute = (instanceId: string) =>
  HttpRouter.add(
    "GET",
    "/health",
    respond(
      Effect.gen(function* () {
        const store = yield* Store;
        return json({
          id: instanceId,
          version: VERSION,
          root: store.root,
          startedAt,
          code,
          runsInFlight: yield* runsInFlight,
        });
      }),
    ),
  );

/**
 * Everything the routes need at request time. The served surface routes through
 * the real harness layer (QK-MONO-005): presence on disk, the tier table, and
 * liveness off the run record.
 *
 * `PtySessions` (QK-WB-004) is deliberately in here rather than beside the
 * routes that use it. `HttpRouter.provideRequest` builds this layer ONCE and
 * hands the resulting context to every request, so the registry is a singleton
 * for the life of the app layer — which is what makes a session outlive the
 * request that created it and lets the layer's finalizer be the thing that
 * guarantees no shell outlives the daemon.
 */
export const servicesLayer = (
  storeLayer: Layer.Layer<Store>,
): Layer.Layer<Store | Ledger | RunRouting | PtySessions | NodeServices.NodeServices> =>
  Layer.mergeAll(layerHarness, ptyLayer).pipe(
    Layer.provideMerge(ledgerLayer),
    Layer.provideMerge(storeLayer),
    Layer.provideMerge(NodeServices.layer),
  );

export interface AppOptions {
  /** An explicit ledger root. Tests always pass a temp dir. */
  readonly root?: string | undefined;
  readonly instanceId?: string | undefined;
  /** An explicit renderer build; otherwise QUIRKS_RENDERER_DIR, else apps/web/dist. */
  readonly rendererDir?: string | undefined;
}

/**
 * The whole surface, in one layer.
 *
 * ORDER OF PRECEDENCE IS STRUCTURAL, NOT POSITIONAL. `rendererRoutes` registers
 * one route, `GET /*`, and find-my-way ranks a wildcard below every static and
 * parametric route — so /v1/*, /shape/*, /health and the pty socket win on their
 * own paths no matter which layer registered first. The renderer is the
 * fallback, never the front.
 *
 * It sits OUTSIDE `provideRequest` deliberately: the router captures its
 * middleware from the context at registration time, so a sibling layer's routes
 * carry none of it. Serving a file needs no store, no ledger and no pty
 * registry, and this is what keeps it from acquiring them.
 */
export const appLayer = (options: AppOptions = {}) => {
  const storeLayer = options.root === undefined ? layerFromCwd() : layerAt(options.root);
  return Layer.mergeAll(
    Layer.mergeAll(routes, ptyRoutes, healthRoute(options.instanceId ?? "quirks-service")).pipe(
      HttpRouter.provideRequest(servicesLayer(storeLayer)),
    ),
    rendererRoutes({ rendererDir: options.rendererDir }),
  );
};

/** An in-process Fetch handler over the whole surface — how the suite drives it.
 *  The request logger belongs to the served process, not to a test transcript. */
export const makeWebHandler = (options: AppOptions = {}) =>
  HttpRouter.toWebHandler(appLayer(options), { disableLogger: true });
