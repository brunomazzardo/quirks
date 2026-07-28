// Task state transitions. Pure over a Task — no I/O; the only failure mode is a
// state change the current status does not allow, and it is a typed failure
// rather than a thrown surprise.
// Ported from the bun-era src/store/transitions.ts (QK-MONO-003).

import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { StatusDetail, Task, TaskStatus } from "@quirks/contracts";

/** A state change the current status does not allow. Not corruption, not
 *  absence — its own failure, reported as such. */
export class TransitionError extends Data.TaggedError("TransitionError")<{
  readonly reason: string;
}> {
  override get message(): string {
    return this.reason;
  }
}

const refuse = (reason: string): Effect.Effect<never, TransitionError> =>
  Effect.fail(new TransitionError({ reason }));

function touched(task: Task): Task {
  return { ...task, revision: task.revision + 1, updatedAt: new Date().toISOString() };
}

export function claim(task: Task, by?: string | undefined): Effect.Effect<Task, TransitionError> {
  if (task.status !== "open") {
    return refuse(`${task.id} is ${task.status}, not open — cannot claim`);
  }
  const statusDetail: StatusDetail = { ...task.statusDetail };
  if (by !== undefined) statusDetail.claimedBy = by;
  return Effect.succeed({ ...touched(task), status: "claimed", statusDetail });
}

export function block(
  task: Task,
  reason: string,
  until?: string | undefined,
): Effect.Effect<Task, TransitionError> {
  if (task.status === "completed") return refuse(`${task.id} is completed — cannot block`);
  if (task.status === "blocked") return refuse(`${task.id} is already blocked`);
  const statusDetail: StatusDetail = {
    ...task.statusDetail,
    blockedReason: reason,
    priorStatus: task.status,
  };
  if (until !== undefined) statusDetail.blockedUntil = until;
  return Effect.succeed({ ...touched(task), status: "blocked", statusDetail });
}

/** claimed → open; blocked → whatever it interrupted. */
export function release(task: Task): Effect.Effect<Task, TransitionError> {
  if (task.status === "claimed") {
    const { claimedBy: _drop, ...rest } = task.statusDetail;
    return Effect.succeed({ ...touched(task), status: "open", statusDetail: rest });
  }
  if (task.status === "blocked") {
    const { blockedReason: _r, blockedUntil: _u, priorStatus: _p, ...rest } = task.statusDetail;
    return Effect.succeed({
      ...touched(task),
      status: task.statusDetail.priorStatus ?? "open",
      statusDetail: rest,
    });
  }
  return refuse(`${task.id} is ${task.status} — nothing to release`);
}

/** Permissive by design: a task finished by hand never needs ceremony to record it. */
export function complete(
  task: Task,
  evidence?: string | undefined,
): Effect.Effect<Task, TransitionError> {
  if (task.status === "completed") return refuse(`${task.id} is already completed`);
  const { blockedReason: _r, blockedUntil: _u, priorStatus: _p, ...rest } = task.statusDetail;
  const statusDetail: StatusDetail = { ...rest };
  if (evidence !== undefined) statusDetail.evidence = evidence;
  return Effect.succeed({ ...touched(task), status: "completed", statusDetail });
}

export function isTerminal(status: TaskStatus): boolean {
  return status === "completed";
}
