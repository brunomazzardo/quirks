// The goal verbs: flag parsing and rendering only — the logic lives in
// src/ops, shared with the service routes.

import { openStore } from "../store/store.ts";
import { createGoal, getGoal, leaveActive, rollup, type GoalRollup } from "../ops/goals.ts";
import { emitJson, emitRead, table } from "./output.ts";

function renderRollup(shown: GoalRollup[], omitted: number): string {
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
  return omitted > 0 ? `${body}\n… ${omitted} done/abandoned goals omitted (--all)` : body;
}

export function goalList(opts: { json: boolean; all: boolean }): void {
  const rows = rollup(openStore());
  const shown = opts.all ? rows : rows.filter((r) => r.state !== "done" && r.state !== "abandoned");
  emitRead(shown, opts.json, () => renderRollup(shown, rows.length - shown.length));
}

export function goalShow(id: string, opts: { json: boolean }): void {
  const { goal, tasks } = getGoal(openStore(), id);
  emitRead({ goal, tasks }, opts.json, () => {
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
      tasks.length === 0
        ? "no tasks yet"
        : table(
            ["task", "status", "title"],
            tasks.map((t) => [t.id, t.status, t.title]),
          ),
    );
    return lines.join("\n");
  });
}

export function goalNew(
  id: string,
  opts: { title: string; why?: string; whyRef?: string; doneWhen: string[] },
): void {
  emitJson(createGoal(openStore(), { id, ...opts }));
}

export function goalDone(id: string, opts: { reason?: string }): void {
  emitJson(leaveActive(openStore(), id, opts.reason, "done"));
}

export function goalAbandon(id: string, opts: { reason?: string }): void {
  emitJson(leaveActive(openStore(), id, opts.reason, "abandoned"));
}
