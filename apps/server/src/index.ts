// The quirks service: the store, the /v1 HTTP surface (QK-MONO-003), and the
// honesty machinery it dispatches with (QK-MONO-005).
// QK-MONO-004 adds the CLI and the `quirks` bin on top of this artifact.
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
  layerHarness,
  layerUnrouted,
  type RunRoutingShape,
  type TaskRouting,
} from "./ops/Routing.ts";

// ---- the honesty machinery (QK-MONO-005) ----

export {
  availability,
  decideLean,
  harnessView,
  routableFrom,
  routeTask,
  type Availability,
  type HarnessRow,
  type HarnessView,
  type Leanable,
} from "./ops/Harness.ts";
export { assembleBrief, type SourceFact, type TaskBrief } from "./ops/Brief.ts";
export {
  TIERS,
  TIER_TABLE,
  canonicalModel,
  resolveTier,
  selectIndependentReviewer,
  tierTable,
  type JudgmentTier,
  type ReviewerSelection,
} from "./harness/Tiers.ts";
export { deriveLiveness, type LivenessState, type RunnerLiveness } from "./harness/Liveness.ts";
export { dispatchRunner, type DispatchInput } from "./runner/Dispatch.ts";
export { resolveVerdict, quoteSupportedByTranscript, type Verdict } from "./runner/Quote.ts";
export {
  statusFromExit,
  type DispatchOutcome,
  type DispatchResult,
  type RunnerKind,
} from "./runner/Types.ts";
export {
  executeRun,
  finalizeRun,
  resumeRun,
  runForExecute,
  runForResume,
  type ParentHooks,
  type RunExecution,
} from "./run/Parent.ts";
export { defaultParentHooks, defaultRouting } from "./run/Hooks.ts";
