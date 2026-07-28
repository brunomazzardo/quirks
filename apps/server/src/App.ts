// The service, assembled: the ledger services, the routing seam, and the /v1
// route surface behind one layer. `toWebHandler` gives tests an in-process
// `fetch`; `dev.ts` serves the same layer over a socket.

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/unstable/http";
import { codeIdentity } from "@quirks/shared";
import { NodeServices } from "@effect/platform-node";
import { Ledger, layer as ledgerLayer, layerAt, layerFromCwd, Store } from "./store/Store.ts";
import { layerUnrouted, RunRouting } from "./ops/Routing.ts";
import { runsInFlight } from "./ops/Runs.ts";
import { routes } from "./http/Routes.ts";
import { json, respond } from "./http/Wire.ts";

export const VERSION = "0.1.0";

/** The code THIS process compiled at startup, captured once — after this point
 *  edits to src/ cannot change what this process runs, which is the whole
 *  problem QK-SRV-006 exists to make visible. */
const code = codeIdentity(new URL(".", import.meta.url).pathname);
const startedAt = new Date().toISOString();

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

/** Everything the routes need at request time. */
export const servicesLayer = (
  storeLayer: Layer.Layer<Store>,
): Layer.Layer<Store | Ledger | RunRouting | NodeServices.NodeServices> =>
  Layer.mergeAll(ledgerLayer, layerUnrouted).pipe(
    Layer.provideMerge(storeLayer),
    Layer.provideMerge(NodeServices.layer),
  );

export interface AppOptions {
  /** An explicit ledger root. Tests always pass a temp dir. */
  readonly root?: string | undefined;
  readonly instanceId?: string | undefined;
}

export const appLayer = (options: AppOptions = {}) => {
  const storeLayer = options.root === undefined ? layerFromCwd() : layerAt(options.root);
  return Layer.mergeAll(routes, healthRoute(options.instanceId ?? "quirks-service")).pipe(
    HttpRouter.provideRequest(servicesLayer(storeLayer)),
  );
};

/** An in-process Fetch handler over the whole surface — how the suite drives it.
 *  The request logger belongs to the served process, not to a test transcript. */
export const makeWebHandler = (options: AppOptions = {}) =>
  HttpRouter.toWebHandler(appLayer(options), { disableLogger: true });
