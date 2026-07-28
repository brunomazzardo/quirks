// The ledger pane's data layer (QK-WB-003).
//
// @effect/atom-react is the house idiom (t3code's apps/web/src/state/*), and
// it fits here: one `Atom.make(effect)` gives a cached read, an AsyncResult
// that carries "still waiting" alongside the last good value, and a
// `useAtomRefresh` handle for the Refresh affordance — which is the whole
// surface this pane needs, with no hand-rolled loading/error/retry state.
//
// Everything is requested SAME-ORIGIN (lib/service.ts): in dev the Vite proxy
// forwards /v1 to the daemon. A cross-origin fetch could not read these
// responses at all — the daemon sets no CORS headers.

import type { GoalRollup, Page, Task } from "@quirks/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/unstable/reactivity";

import { serviceBaseUrl } from "~/lib/service";

/** Page size per request. The routes default to 100 (src/service/app.ts). */
const PAGE_LIMIT = 200;

/** A backstop so a pathological `total` cannot spin the loop forever. */
const MAX_PAGES = 25;

/** What the pane reads: one fetch of both lists, so both are of one moment. */
export interface LedgerSnapshot {
  readonly goals: readonly GoalRollup[];
  readonly tasks: readonly Task[];
  readonly fetchedAt: Date;
}

function asError(cause: unknown): Error {
  if (cause instanceof Error) return cause;
  return new Error(String(cause));
}

const fetchPage = <T>(path: string): Effect.Effect<Page<T>, Error> =>
  Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(`${serviceBaseUrl()}${path}`, { cache: "no-store", signal });
      if (!response.ok) {
        // Through the dev proxy a stopped daemon surfaces as a 5xx from Vite
        // rather than a rejected fetch, so a bad status is the down-signal.
        throw new Error(`GET ${path} → HTTP ${response.status}`);
      }
      return (await response.json()) as Page<T>;
    },
    catch: asError,
  });

/** Walk `?offset=&limit=` until the reported total is in hand (D6 paginates). */
const fetchAll = <T>(path: string): Effect.Effect<T[], Error> =>
  Effect.gen(function* () {
    const separator = path.includes("?") ? "&" : "?";
    const items: T[] = [];
    for (let request = 0; request < MAX_PAGES; request += 1) {
      const page = yield* fetchPage<T>(
        `${path}${separator}offset=${items.length}&limit=${PAGE_LIMIT}`,
      );
      items.push(...page.items);
      if (page.items.length === 0 || items.length >= page.total) break;
    }
    return items;
  });

/**
 * Goals and tasks as one snapshot.
 *
 * `?all=true` is deliberate: it is what makes the View menu's "Goals · Idle"
 * and "Goals · All" honest, since done and abandoned goals are omitted from
 * the default listing (src/service/app.ts). The goal-state filter then runs
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
