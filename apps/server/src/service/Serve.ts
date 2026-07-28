// `quirks serve` — the hidden verb the CLI's autostart re-invokes.
//
// This is the ONLY module the CLI reaches that loads the service, and it is
// reached through a dynamic import (src/cli/Daemon.ts) so no ordinary verb pays
// for the store, the ops layer, or the HTTP router at startup. Bind failure is
// the interesting case: EADDRINUSE means a daemon is already up and the caller
// should attach, never bind twice.

import { NodeServices } from "@effect/platform-node";
import * as Effect from "effect/Effect";
import { cliError, type CliError } from "../cli/Output.ts";
import { resolveRoot } from "../store/Store.ts";
import { isAddressInUse, serveDaemon } from "./Daemon.ts";
import { portForRoot } from "./Machine.ts";

export const runServe = (port?: string): Effect.Effect<void, CliError> =>
  Effect.gen(function* () {
    const root = resolveRoot();
    const bind = port ? Number.parseInt(port, 10) : portForRoot(root);
    yield* serveDaemon({ root, port: bind }).pipe(
      Effect.catch((error) =>
        error._tag === "ServeError" && isAddressInUse(error)
          ? Effect.fail(
              cliError(`a daemon already holds port ${bind} — attach instead of binding twice`),
            )
          : Effect.die(error),
      ),
      Effect.provide(NodeServices.layer),
      Effect.asVoid,
    );
  });
