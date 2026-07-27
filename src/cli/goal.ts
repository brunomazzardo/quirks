import { existsSync } from "node:fs";
import { goalIdOfTask, isValidGoalId } from "../store/ids.ts";
import {
  loadGoals,
  loadTasks,
  makeSourceRef,
  openStore,
  saveGoals,
} from "../store/store.ts";
import type { Goal, Task } from "../store/types.ts";
import { CliError, emitJson, emitRead, table } from "./output.ts";

interface GoalRollup {
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
function rollup(goals: Goal[], tasks: Task[]): GoalRollup[] {
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

function findGoal(goals: Goal[], id: string): Goal {
  const goal = goals.find((g) => g.id === id);
  if (!goal) throw new CliError(`no goal ${id} — quirks goal list shows what exists`);
  return goal;
}

function leaveActive(id: string, reason: string | undefined, state: "done" | "abandoned"): void {
  if (!reason) {
    throw new CliError(
      `--reason is required: a goal leaving active with no reason is how a ledger starts lying`,
    );
  }
  const store = openStore();
  const goals = loadGoals(store);
  const goal = findGoal(goals, id);
  if (goal.state !== "active") {
    throw new CliError(`${id} is already ${goal.state} (${goal.stateReason ?? "no reason recorded"})`);
  }
  goal.state = state;
  goal.stateReason = reason;
  goal.revision += 1;
  goal.updatedAt = new Date().toISOString();
  saveGoals(store, goals);
  emitJson(goal);
}

export function goalList(opts: { json: boolean; all: boolean }): void {
  const store = openStore();
  const rows = rollup(loadGoals(store), loadTasks(store));
  const shown = opts.all ? rows : rows.filter((r) => r.state !== "done" && r.state !== "abandoned");
  emitRead(shown, opts.json, () => {
    const body = table(
      ["goal", "total", "done", "open", "blocked", "future", "state"],
      shown.map((r) => [
        r.id,
        String(r.total),
        String(r.done),
        String(r.open),
        String(r.blocked),
        String(r.future),
        r.state,
      ]),
    );
    const omitted = rows.length - shown.length;
    return omitted > 0 ? `${body}\n… ${omitted} done/abandoned goals omitted (--all)` : body;
  });
}

export function goalShow(id: string, opts: { json: boolean }): void {
  const store = openStore();
  const goal = findGoal(loadGoals(store), id);
  const members = loadTasks(store).filter((t) => goalIdOfTask(t.id) === id);
  emitRead({ goal, tasks: members }, opts.json, () => {
    const lines = [
      `${goal.id} — ${goal.title}   [${goal.state}${goal.stateReason ? `: ${goal.stateReason}` : ""}]`,
    ];
    if (goal.why.text) lines.push(`why: ${goal.why.text}`);
    if (goal.why.ref) {
      lines.push(`why: ${goal.why.ref.path} @ ${goal.why.ref.pinnedCommit?.slice(0, 7) ?? "unpinned"}`);
    }
    for (const c of goal.doneWhen) lines.push(`done when: ${c}`);
    lines.push("");
    lines.push(
      members.length === 0
        ? "no tasks yet"
        : table(
            ["task", "status", "title"],
            members.map((t) => [t.id, t.status, t.title]),
          ),
    );
    return lines.join("\n");
  });
}

export function goalNew(
  id: string,
  opts: { title: string; why?: string; whyRef?: string; doneWhen: string[] },
): void {
  if (!isValidGoalId(id)) {
    throw new CliError(
      `a goal id is the task-id prefix: QK- plus a tag starting with a letter (got ${JSON.stringify(id)})`,
    );
  }
  if (!opts.why && !opts.whyRef) {
    throw new CliError(
      "a goal without a why is the intent loss this tool exists to prevent — give --why and/or --why-ref",
    );
  }
  if (opts.why && !opts.whyRef && existsSync(opts.why)) {
    throw new CliError(
      `--why ${opts.why} is an existing file — a pointer belongs in --why-ref, --why is the sentence`,
    );
  }
  const store = openStore();
  const goals = loadGoals(store);
  if (goals.some((g) => g.id === id)) throw new CliError(`goal ${id} already exists`);
  const now = new Date().toISOString();
  const goal: Goal = {
    id,
    title: opts.title,
    why: {
      ...(opts.why ? { text: opts.why } : {}),
      ...(opts.whyRef ? { ref: makeSourceRef(store, opts.whyRef) } : {}),
    },
    doneWhen: opts.doneWhen,
    state: "active",
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
  goals.push(goal);
  saveGoals(store, goals);
  emitJson(goal);
}

export function goalDone(id: string, opts: { reason?: string }): void {
  leaveActive(id, opts.reason, "done");
}

export function goalAbandon(id: string, opts: { reason?: string }): void {
  leaveActive(id, opts.reason, "abandoned");
}
