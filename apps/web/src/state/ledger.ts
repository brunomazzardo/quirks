// The ledger pane's data layer (QK-WB-003).
//
// @effect/atom-react is the house idiom (t3code's apps/web/src/state/*), and
// it fits here: one `Atom.make(effect)` gives a cached read, an AsyncResult
// that carries "still waiting" alongside the last good value, and a
// `useAtomRefresh` handle for the Refresh affordance — which is the whole
// surface this pane needs, with no hand-rolled loading/error/retry state.
//
// The fetch itself lives in ./wire.ts, shared with the run views (QK-WB-007):
// same-origin, same paging walk, same down-signal.

import type { GoalRollup, Task } from "@quirks/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/unstable/reactivity";

import { fetchAll } from "~/state/wire";

/** What the pane reads: one fetch of both lists, so both are of one moment. */
export interface LedgerSnapshot {
  readonly goals: readonly GoalRollup[];
  readonly tasks: readonly Task[];
  readonly fetchedAt: Date;
}

/**
 * Goals and tasks as one snapshot.
 *
 * `?all=true` is deliberate: it is what makes the View menu's "Goals · Idle"
 * and "Goals · All" honest, since done and abandoned goals are omitted from
 * the default listing (apps/server/src/http/Routes.ts). The goal-state filter
 * then runs
 * client-side over the full set, exactly as the native workbench filtered over
 * whatever it had fetched.
 */
export const ledgerAtom = Atom.make(
  Effect.gen(function* () {
    const [goals, tasks] = yield* Effect.all(
      [fetchAll<GoalRollup>("/v1/goals?all=true"), fetchAll<Task>("/v1/tasks")],
      { concurrency: 2 },
    );
    return { goals, tasks, fetchedAt: new Date() } satisfies LedgerSnapshot;
  }),
).pipe(Atom.withLabel("ledger"));
