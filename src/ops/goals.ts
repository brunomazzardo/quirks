// Goal operations — the logic both the CLI and the service routes call.
// Only this layer and ops/tasks.ts touch the store modules.

import { existsSync } from "node:fs";
import { goalIdOfTask, isValidGoalId } from "../store/ids.ts";
import { loadGoals, loadTasks, makeSourceRef, saveGoals, type Store } from "../store/store.ts";
import type { Goal, Task } from "../store/types.ts";
import { ConflictError, NotFoundError, ValidationError } from "./errors.ts";

export interface GoalRollup {
  id: string;
  title: string | null;
  recorded: boolean;
  state: string;
  total: number;
  done: number;
  open: number;
  blocked: number;
  future: number;
}

/** The union the founding doc requires: recorded goals, goals implied by task-id
 *  prefixes nobody declared, and the bare-number namespace when it has tasks. */
export function rollup(store: Store): GoalRollup[] {
  const goals = loadGoals(store);
  const tasks = loadTasks(store);
  const byId = new Map<string, GoalRollup>();
  for (const g of goals) {
    byId.set(g.id, {
      id: g.id,
      title: g.title,
      recorded: true,
      state: g.state,
      total: 0,
      done: 0,
      open: 0,
      blocked: 0,
      future: 0,
    });
  }
  for (const t of tasks) {
    const gid = goalIdOfTask(t.id) ?? "(no goal)";
    let row = byId.get(gid);
    if (!row) {
      row = {
        id: gid,
        title: null,
        recorded: false,
        state: "implied",
        total: 0,
        done: 0,
        open: 0,
        blocked: 0,
        future: 0,
      };
      byId.set(gid, row);
    }
    row.total += 1;
    if (t.status === "completed") row.done += 1;
    else if (t.status === "blocked") row.blocked += 1;
    else if (t.future) row.future += 1; // deliberately not now — not open work
    else row.open += 1;
  }
  for (const row of byId.values()) {
    if (row.state !== "active") continue;
    if (row.done === 0) row.state = "not started";
    else if (row.open + row.blocked > 0) row.state = "in progress";
    else row.state = "tasks done"; // awaiting the doneWhen assertion
  }
  return [...byId.values()].sort((a, b) => b.open - a.open || a.id.localeCompare(b.id));
}

export function getGoal(store: Store, id: string): { goal: Goal; tasks: Task[] } {
  const goal = loadGoals(store).find((g) => g.id === id);
  if (!goal) throw new NotFoundError(`no goal ${id} — quirks goal list shows what exists`);
  const tasks = loadTasks(store).filter((t) => goalIdOfTask(t.id) === id);
  return { goal, tasks };
}

export interface NewGoalInput {
  id: string;
  title: string;
  why?: string | undefined;
  whyRef?: string | undefined;
  doneWhen: string[];
}

export function createGoal(store: Store, input: NewGoalInput): Goal {
  if (!isValidGoalId(input.id)) {
    throw new ValidationError(
      `a goal id is the task-id prefix: QK- plus a tag starting with a letter (got ${JSON.stringify(input.id)})`,
    );
  }
  if (!input.title) throw new ValidationError("--title is required");
  if (!input.why && !input.whyRef) {
    throw new ValidationError(
      "a goal without a why is the intent loss this tool exists to prevent — give --why and/or --why-ref",
    );
  }
  if (input.why && !input.whyRef && existsSync(input.why)) {
    throw new ValidationError(
      `--why ${input.why} is an existing file — a pointer belongs in --why-ref, --why is the sentence`,
    );
  }
  const goals = loadGoals(store);
  if (goals.some((g) => g.id === input.id)) throw new ConflictError(`goal ${input.id} already exists`);
  const now = new Date().toISOString();
  const goal: Goal = {
    id: input.id,
    title: input.title,
    why: {
      ...(input.why ? { text: input.why } : {}),
      ...(input.whyRef ? { ref: makeSourceRef(store, input.whyRef) } : {}),
    },
    doneWhen: input.doneWhen,
    state: "active",
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
  goals.push(goal);
  saveGoals(store, goals);
  return goal;
}

export function leaveActive(
  store: Store,
  id: string,
  reason: string | undefined,
  state: "done" | "abandoned",
): Goal {
  if (!reason) {
    throw new ValidationError(
      `--reason is required: a goal leaving active with no reason is how a ledger starts lying`,
    );
  }
  const goals = loadGoals(store);
  const goal = goals.find((g) => g.id === id);
  if (!goal) throw new NotFoundError(`no goal ${id} — quirks goal list shows what exists`);
  if (goal.state !== "active") {
    throw new ConflictError(`${id} is already ${goal.state} (${goal.stateReason ?? "no reason recorded"})`);
  }
  goal.state = state;
  goal.stateReason = reason;
  goal.revision += 1;
  goal.updatedAt = new Date().toISOString();
  saveGoals(store, goals);
  return goal;
}
