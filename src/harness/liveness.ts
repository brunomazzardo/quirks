// "Can tonight's run lean on codex?" — answered from the run record, not from a
// live round trip (QK-HARN goal doneWhen; the operator chose this over probing).
//
// This is D7's own framing applied literally: surface state the system already
// computes. Every dispatch already records its runner, exit code, timestamp, and
// the runner's own complaint; a quota refusal is therefore a dated fact we own.
// It is what retires the "codex is usage-limited until Jul 28 2026 2:02 PM" prose
// in a checked-in doc — the replacement has a real timestamp behind it, from a
// real transcript (docs/evidence/managing-agent-probe.md:49-51 is that exact
// refusal, recorded).

import type { Run, RunDispatchRecord } from "../store/types.ts";
import type { RunnerKind } from "../runner/types.ts";

export type LivenessState =
  /** Most recent dispatch succeeded. */
  | "answered"
  /** Most recent dispatch ran and failed — reason carries the runner's words. */
  | "failed"
  /** Most recent dispatch timed out. Not evidence it is broken, only silent. */
  | "timed-out"
  /** No dispatch on this runner has ever been recorded. */
  | "never-dispatched";

export interface RunnerLiveness {
  runner: RunnerKind;
  state: LivenessState;
  /** The dispatch this verdict rests on. Null only when never-dispatched. */
  last: (RunDispatchRecord & { runId: string; taskId: string }) | null;
  /** How many dispatches we scanned for this runner. */
  observed: number;
}

const ALL_RUNNERS: readonly RunnerKind[] = ["claude", "codex", "cursor"];

function stateFor(status: string): LivenessState {
  if (status === "success") return "answered";
  if (status === "timeout") return "timed-out";
  return "failed";
}

/** Flatten every recorded dispatch across every run, newest last. */
export function allDispatches(
  runs: readonly Run[],
): Array<RunDispatchRecord & { runId: string; taskId: string }> {
  const out: Array<RunDispatchRecord & { runId: string; taskId: string }> = [];
  for (const run of runs) {
    for (const rec of run.tasks ?? []) {
      for (const dispatch of rec.dispatches ?? []) {
        out.push({ ...dispatch, runId: run.id, taskId: rec.taskId });
      }
    }
  }
  // ISO-8601 sorts lexicographically. Ties keep insertion order (stable sort).
  out.sort((a, b) => a.dispatchedAt.localeCompare(b.dispatchedAt));
  return out;
}

/**
 * The newest dispatch per runner decides its liveness. Absence stays absence:
 * a runner nobody has dispatched is `never-dispatched`, never "answered".
 */
export function deriveLiveness(runs: readonly Run[]): RunnerLiveness[] {
  const dispatches = allDispatches(runs);
  return ALL_RUNNERS.map((runner) => {
    const mine = dispatches.filter((d) => d.runner === runner);
    const last = mine[mine.length - 1];
    if (!last) {
      return { runner, state: "never-dispatched" as const, last: null, observed: 0 };
    }
    return { runner, state: stateFor(last.status), last, observed: mine.length };
  });
}

/** Human-readable age, for the table. */
export function describeAge(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "at an unparseable time";
  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (seconds < 90) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** One line per runner: what happened last, and when. */
export function describeLiveness(entry: RunnerLiveness, now: Date = new Date()): string {
  if (entry.state === "never-dispatched" || !entry.last) return "never dispatched";
  const when = describeAge(entry.last.dispatchedAt, now);
  switch (entry.state) {
    case "answered":
      return `answered ${when}`;
    case "timed-out":
      return `timed out ${when}`;
    case "failed": {
      const why = entry.last.failureMessage?.split("\n")[0]?.slice(0, 80);
      return `failed ${when}${why ? ` — ${why}` : ""}`;
    }
  }
}
