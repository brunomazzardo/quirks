// Serve the /v1 surface over a loopback socket.
//
// Port selection follows the bun-era daemon (src/service/daemon.ts): QUIRKS_PORT
// wins, otherwise a stable hash of the repo root into the dynamic range so two
// repos' services never collide without a registry. PORT is accepted as the
// conventional Node fallback. Bind-or-attach, the daemon record, and log
// rotation are QK-MONO-004's business; this entry only serves.

import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/unstable/http";
import { appLayer } from "./App.ts";
import { resolveRoot } from "./store/Store.ts";

function envPort(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const p = Number.parseInt(raw, 10);
  return Number.isInteger(p) && p > 1023 && p < 65536 ? p : null;
}

/** Interim per-repo port: a stable hash of the repo root into the dynamic
 *  range, so two repos' services never collide without a registry. */
export function portForRoot(root: string): number {
  const explicit = envPort("QUIRKS_PORT") ?? envPort("PORT");
  if (explicit !== null) return explicit;
  const h = createHash("sha256").update(root).digest();
  return 45000 + (h.readUInt32BE(0) % 15000);
}

const root = resolveRoot();
const port = portForRoot(root);

const ServerLive = NodeHttpServer.layer(createServer, { host: "127.0.0.1", port });

const main = HttpRouter.serve(appLayer({ root, instanceId: randomUUID() })).pipe(
  Layer.provide(ServerLive),
  Layer.launch,
  Effect.tap(() => Effect.logInfo("quirks service listening", { root, port })),
);

NodeRuntime.runMain(main);
