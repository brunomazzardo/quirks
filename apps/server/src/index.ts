// The quirks service: the store and the /v1 HTTP surface (QK-MONO-003).
// QK-MONO-004 adds the CLI and the `quirks` bin on top of this artifact;
// QK-MONO-005 fills the three routes that answer 501 today.
//
// The contract is imported type-only (D3a) — the alias below is the proof the
// boundary holds.
import type { Task } from "@quirks/contracts";

export type LedgerTask = Task;

export { appLayer, makeWebHandler, servicesLayer, VERSION, type AppOptions } from "./App.ts";
export { Ledger, Store, layerAt, layerFromCwd, resolveRoot } from "./store/Store.ts";
export { StoreCorruptError, type StoreError } from "./store/JsonFile.ts";
export { TransitionError } from "./store/Transitions.ts";
export { ConflictError, NotFoundError, ValidationError, type OpError } from "./ops/Errors.ts";
export {
  RunRouting,
  layerUnrouted,
  type RunRoutingShape,
  type TaskRouting,
} from "./ops/Routing.ts";
