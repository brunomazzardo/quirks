import type { Task, TaskStatus } from "./types.ts";

/** A state change the current status does not allow. Not corruption, not absence —
 *  its own failure, reported as such. */
export class TransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransitionError";
  }
}

function touched(task: Task): Task {
  return { ...task, revision: task.revision + 1, updatedAt: new Date().toISOString() };
}

export function claim(task: Task, by?: string): Task {
  if (task.status !== "open") {
    throw new TransitionError(`${task.id} is ${task.status}, not open — cannot claim`);
  }
  const next = touched(task);
  next.status = "claimed";
  next.statusDetail = { ...task.statusDetail };
  if (by !== undefined) next.statusDetail.claimedBy = by;
  return next;
}

export function block(task: Task, reason: string, until?: string): Task {
  if (task.status === "completed") {
    throw new TransitionError(`${task.id} is completed — cannot block`);
  }
  if (task.status === "blocked") {
    throw new TransitionError(`${task.id} is already blocked`);
  }
  const next = touched(task);
  next.status = "blocked";
  next.statusDetail = {
    ...task.statusDetail,
    blockedReason: reason,
    priorStatus: task.status,
  };
  if (until !== undefined) next.statusDetail.blockedUntil = until;
  return next;
}

/** claimed → open; blocked → whatever it interrupted. */
export function release(task: Task): Task {
  const next = touched(task);
  if (task.status === "claimed") {
    next.status = "open";
    const { claimedBy: _drop, ...rest } = task.statusDetail;
    next.statusDetail = rest;
    return next;
  }
  if (task.status === "blocked") {
    next.status = task.statusDetail.priorStatus ?? "open";
    const { blockedReason: _r, blockedUntil: _u, priorStatus: _p, ...rest } = task.statusDetail;
    next.statusDetail = rest;
    return next;
  }
  throw new TransitionError(`${task.id} is ${task.status} — nothing to release`);
}

/** Permissive by design: a task finished by hand never needs ceremony to record it. */
export function complete(task: Task, evidence?: string): Task {
  if (task.status === "completed") {
    throw new TransitionError(`${task.id} is already completed`);
  }
  const next = touched(task);
  next.status = "completed";
  const { blockedReason: _r, blockedUntil: _u, priorStatus: _p, ...rest } = task.statusDetail;
  next.statusDetail = rest;
  if (evidence !== undefined) next.statusDetail.evidence = evidence;
  return next;
}

export function isTerminal(status: TaskStatus): boolean {
  return status === "completed";
}
