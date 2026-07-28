// Goal operations — the logic every surface calls. Only this layer and
// ops/Tasks.ts + ops/Runs.ts touch the Ledger service.
// Ported from the bun-era src/ops/goals.ts (QK-MONO-003).

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import type { Goal, GoalRollup, GoalState, Task } from "@quirks/contracts";
import { goalIdOfTask, isValidGoalId } from "../store/Ids.ts";
import { Ledger, Store } from "../store/Store.ts";
import type { StoreError } from "../store/JsonFile.ts";
import { conflict, invalid, missing, type OpError } from "./Errors.ts";

/** The union the founding doc requires: recorded goals, goals implied by task-id
 *  prefixes nobody declared, and the bare-number namespace when it has tasks. */
export const rollup: Effect.Effect<GoalRollup[], StoreError, Ledger> = Effect.gen(function* () {
  const ledger = yield* Ledger;
  const goals = yield* ledger.loadGoals;
  const tasks = yield* ledger.loadTasks;
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
    else if (t.future)
      row.future += 1; // deliberately not now — not open work
    else row.open += 1;
  }
  for (const row of byId.values()) {
    if (row.state !== "active") continue;
    if (row.done === 0) row.state = "not started";
    else if (row.open + row.blocked > 0) row.state = "in progress";
    else row.state = "tasks done"; // awaiting the doneWhen assertion
  }
  return [...byId.values()].sort((a, b) => b.open - a.open || a.id.localeCompare(b.id));
});

export interface GoalDetail {
  readonly goal: Goal;
  readonly tasks: Task[];
}

export const getGoal = (id: string): Effect.Effect<GoalDetail, StoreError | OpError, Ledger> =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const goal = (yield* ledger.loadGoals).find((g) => g.id === id);
    if (!goal) return yield* missing(`no goal ${id} — quirks goal list shows what exists`);
    const tasks = (yield* ledger.loadTasks).filter((t) => goalIdOfTask(t.id) === id);
    return { goal, tasks };
  });

export interface NewGoalInput {
  readonly id: string;
  readonly title: string;
  readonly why?: string | undefined;
  readonly whyRef?: string | undefined;
  readonly doneWhen: string[];
}

export const createGoal = (
  input: NewGoalInput,
): Effect.Effect<Goal, StoreError | OpError, Ledger | Store | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const store = yield* Store;
    const fs = yield* FileSystem.FileSystem;

    if (!isValidGoalId(input.id)) {
      return yield* invalid(
        `a goal id is the task-id prefix: QK- plus a tag starting with a letter (got ${JSON.stringify(input.id)})`,
      );
    }
    if (!input.title) return yield* invalid("--title is required");
    if (!input.why && !input.whyRef) {
      return yield* invalid(
        "a goal without a why is the intent loss this tool exists to prevent — give --why and/or --why-ref",
      );
    }
    if (input.why && !input.whyRef) {
      const looksLikeFile = yield* fs.exists(input.why).pipe(Effect.orElseSucceed(() => false));
      if (looksLikeFile) {
        return yield* invalid(
          `--why ${input.why} is an existing file — a pointer belongs in --why-ref, --why is the sentence`,
        );
      }
    }
    const goals = yield* ledger.loadGoals;
    if (goals.some((g) => g.id === input.id)) {
      return yield* conflict(`goal ${input.id} already exists`);
    }
    const now = new Date().toISOString();
    const goal: Goal = {
      id: input.id,
      title: input.title,
      why: {
        ...(input.why ? { text: input.why } : {}),
        ...(input.whyRef ? { ref: yield* store.makeSourceRef(input.whyRef) } : {}),
      },
      doneWhen: input.doneWhen,
      state: "active",
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    goals.push(goal);
    yield* ledger.saveGoals(goals);
    return goal;
  });

export const leaveActive = (
  id: string,
  reason: string | undefined,
  state: Extract<GoalState, "done" | "abandoned">,
): Effect.Effect<Goal, StoreError | OpError, Ledger> =>
  Effect.gen(function* () {
    if (!reason) {
      return yield* invalid(
        `--reason is required: a goal leaving active with no reason is how a ledger starts lying`,
      );
    }
    const ledger = yield* Ledger;
    const goals = yield* ledger.loadGoals;
    const goal = goals.find((g) => g.id === id);
    if (!goal) return yield* missing(`no goal ${id} — quirks goal list shows what exists`);
    if (goal.state !== "active") {
      return yield* conflict(
        `${id} is already ${goal.state} (${goal.stateReason ?? "no reason recorded"})`,
      );
    }
    goal.state = state;
    goal.stateReason = reason;
    goal.revision += 1;
    goal.updatedAt = new Date().toISOString();
    yield* ledger.saveGoals(goals);
    return goal;
  });
