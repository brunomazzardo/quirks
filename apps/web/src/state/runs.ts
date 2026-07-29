// The run views' data layer (QK-WB-007).
//
// Two reads, both plain GETs — the run surface has no SSE (unlike /shape), so
// "live" is this file plus a timer in the component. That is deliberate on the
// server's side and cheap on ours: a run record is small JSON over loopback.
//
//   runsAtom      GET /v1/runs, paged to the end. Backs the list AND the
//                 Ledger rail's Runs entry, so both read one cached snapshot
//                 rather than each opening their own request.
//   runAtom(id)   GET /v1/runs/:id. An Atom family keyed by the route param,
//                 so navigating between two runs does not evict either, and
//                 `useAtomRefresh(runAtom(id))` is the whole polling handle.
//
// `:id` accepts a run id OR its slug (ops/Runs.ts `getRun`), which is why the
// key is the raw route param and never parsed here.

import type { Run } from "@quirks/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/unstable/reactivity";

import { fetchAll, fetchJson } from "~/state/wire";

/** A read of the whole run list, stamped with when it happened. */
export interface RunsSnapshot {
  readonly runs: readonly Run[];
  readonly fetchedAt: Date;
}

/** One run, stamped — the live view shows the stamp, because a view that
 *  claims to be live has to be able to say how live. */
export interface RunSnapshot {
  readonly run: Run;
  readonly fetchedAt: Date;
}

export const runsAtom = Atom.make(
  Effect.gen(function* () {
    const runs = yield* fetchAll<Run>("/v1/runs");
    return { runs, fetchedAt: new Date() } satisfies RunsSnapshot;
  }),
).pipe(Atom.withLabel("runs"));

export const runAtom = Atom.family((idOrSlug: string) =>
  Atom.make(
    Effect.gen(function* () {
      const run = yield* fetchJson<Run>(`/v1/runs/${encodeURIComponent(idOrSlug)}`);
      return { run, fetchedAt: new Date() } satisfies RunSnapshot;
    }),
  ).pipe(Atom.withLabel(`run:${idOrSlug}`)),
);
