// Failure policy for a run (QK-RUN-005 / D3 + D13).
// A failed task blocks its dependents — never the whole run.
// park-on-issue uses Pilot's phase boundary: before a landing commit,
// failure releases; after a verified landing, failure holds and never
// unassigns verified work.

import type { RunMode } from "../store/types.ts";

export type FailureAction = "release" | "hold" | "continue";

export interface FailureDecision {
  /** What to do with the failed task itself. */
  action: FailureAction;
  /** Task ids in this run that must be marked blocked (direct + transitive). */
  blockDependents: string[];
  reason: string;
}

/**
 * Direct-and-transitive dependents of `failedId` within `taskIds`, using the
 * dependsOn map. Order is stable (sorted) so reports don't flicker.
 */
export function dependentsOf(
  failedId: string,
  taskIds: readonly string[],
  dependsOn: ReadonlyMap<string, readonly string[]>,
): string[] {
  const inRun = new Set(taskIds);
  const blocked = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const id of taskIds) {
      if (blocked.has(id) || id === failedId) continue;
      const deps = dependsOn.get(id) ?? [];
      if (deps.some((d) => d === failedId || blocked.has(d))) {
        if (inRun.has(id)) {
          blocked.add(id);
          grew = true;
        }
      }
    }
  }
  return [...blocked].sort();
}

/**
 * Decide the fate of a failed task and which peers it takes with it.
 *
 * - Both modes block dependents (the run continues).
 * - `park-on-issue` + no landing commit → release (unassign).
 * - `park-on-issue` + verified landing → hold (never unassign verified work).
 * - `autonomous` → continue (parent already decided; record the failure and move on).
 */
export function decideFailure(input: {
  mode: RunMode;
  failedId: string;
  /** Set only when a verified landing commit exists for this task. */
  landingCommit: string | null;
  taskIds: readonly string[];
  dependsOn: ReadonlyMap<string, readonly string[]>;
  detail?: string;
}): FailureDecision {
  const blockDependents = dependentsOf(input.failedId, input.taskIds, input.dependsOn);
  const detail = input.detail ? `: ${input.detail}` : "";

  if (input.mode === "autonomous") {
    return {
      action: "continue",
      blockDependents,
      reason: `autonomous: recorded failure on ${input.failedId}${detail}; dependents blocked, run continues`,
    };
  }

  // park-on-issue — Pilot phase boundary at LAND.
  if (input.landingCommit) {
    return {
      action: "hold",
      blockDependents,
      reason:
        `park-on-issue: verified landing ${input.landingCommit} exists for ${input.failedId}${detail} — holding for the operator, never unassigning verified work`,
    };
  }
  return {
    action: "release",
    blockDependents,
    reason: `park-on-issue: no landing commit for ${input.failedId}${detail} — releasing so the work is not held overnight without a landing`,
  };
}
