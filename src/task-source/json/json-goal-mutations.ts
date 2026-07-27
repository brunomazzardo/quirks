import { sha256 } from "../../core/hash.js";
import type { GoalMutationRequest, NativeGoal } from "../types.js";
import type { TaskEnvelope } from "./json-mutations.js";

/**
 * A goal's revision, on the same terms as a task's: the hash of the record,
 * so a stale `update-goal` is caught the way a stale task mutation is.
 */
export function goalRevision(goal: NativeGoal): string {
  return sha256(goal as unknown as Record<string, unknown>);
}

export type GoalMutationOutcome =
  | { readonly kind: "ok"; readonly goal: NativeGoal; readonly goals: NativeGoal[] }
  | { readonly kind: "not_found" }
  | { readonly kind: "conflict"; readonly reason: string }
  | { readonly kind: "stale" };

function applyProposeGoal(
  existing: readonly NativeGoal[],
  request: Extract<GoalMutationRequest, { operation: "propose-goal" }>,
): GoalMutationOutcome {
  if (existing.some((goal) => goal.id === request.goalId)) {
    return { kind: "conflict", reason: `Goal ${request.goalId} already exists` };
  }
  if (request.input.goal.id !== request.goalId) {
    return { kind: "conflict", reason: "Goal id does not match the request" };
  }
  const goal = request.input.goal;
  return { kind: "ok", goal, goals: [...existing, goal] };
}

function applyUpdateGoal(
  existing: readonly NativeGoal[],
  request: Extract<GoalMutationRequest, { operation: "update-goal" }>,
  now: string,
): GoalMutationOutcome {
  const index = existing.findIndex((goal) => goal.id === request.goalId);
  if (index < 0) return { kind: "not_found" };

  const current = existing[index]!;
  if (goalRevision(current) !== request.expectedNativeRevision) return { kind: "stale" };

  // A goal leaving `active` must say why. "abandoned" with no reason is the
  // silent backlog rot this object exists to make visible, and a bare "done"
  // hides which criteria were judged met.
  const nextState = request.input.state ?? current.state;
  if (nextState !== "active" && !request.input.stateReason && !current.stateReason) {
    return { kind: "conflict", reason: `Moving a goal to ${nextState} requires a reason` };
  }

  const updated: NativeGoal = {
    ...current,
    ...(request.input.title === undefined ? {} : { title: request.input.title }),
    ...(request.input.why === undefined ? {} : { why: request.input.why }),
    ...(request.input.doneWhen === undefined ? {} : { doneWhen: request.input.doneWhen }),
    ...(request.input.state === undefined ? {} : { state: request.input.state }),
    ...(request.input.stateReason === undefined ? {} : { stateReason: request.input.stateReason }),
    updatedAt: now,
  };

  const goals = existing.slice();
  goals[index] = updated;
  return { kind: "ok", goal: updated, goals };
}

export function applyGoalMutation(
  envelope: TaskEnvelope,
  request: GoalMutationRequest,
  now: string,
): GoalMutationOutcome {
  const existing = envelope.goals ?? [];
  return request.operation === "propose-goal"
    ? applyProposeGoal(existing, request)
    : applyUpdateGoal(existing, request, now);
}
