// Serve the /v1 surface over a loopback socket, in the foreground.
//
// This is `quirks serve` without commander in front of it: the same
// `serveDaemon` the CLI autostarts (src/service/Daemon.ts), so a service you
// start by hand and a service the CLI starts for you are the same assembly.
// Port selection is the one derivation both sides share (src/service/Machine.ts):
// QUIRKS_PORT wins, otherwise a stable hash of the repo root into the dynamic
// range so two repos' services never collide without a registry.

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import * as Effect from "effect/Effect";
import { serveDaemon } from "./service/Daemon.ts";
import { portForRoot } from "./service/Machine.ts";
import { resolveRoot } from "./store/Store.ts";

const root = resolveRoot();

// `serveDaemon` prints the bound port itself, so there is one place that says
// where the service is and it says it after the socket is actually held.
NodeRuntime.runMain(
  serveDaemon({ root, port: portForRoot(root) }).pipe(Effect.provide(NodeServices.layer)),
);
