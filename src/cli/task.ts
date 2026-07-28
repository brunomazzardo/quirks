// The task verbs: flag parsing and rendering only — the logic lives in
// src/ops, shared with the service routes.

import { openStore } from "../store/store.ts";
import { ValidationError } from "../ops/errors.ts";
import {
  blockTask,
  claimTask,
  completeTask,
  getTask,
  listTasks,
  proposeTask,
  releaseTask,
} from "../ops/tasks.ts";
import type { Task } from "../store/types.ts";
import { emitJson, emitRead, table } from "./output.ts";

function parseIfRevision(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) throw new ValidationError(`--if-revision wants a number, got ${JSON.stringify(value)}`);
  return n;
}

function flagMarks(t: Task): string {
  return [
    t.needsDesign ? "design?" : "",
    t.needsBreakdown ? "breakdown?" : "",
    t.future ? "future" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function taskPropose(opts: {
  title: string;
  goal?: string;
  dependsOn: string[];
  deliverable: string[];
  criterion: string[];
  verify: string[];
  source: string[];
  effort?: string;
  risk?: string;
  needsDesign: boolean;
  needsBreakdown: boolean;
  future: boolean;
}): void {
  emitJson(
    proposeTask(openStore(), {
      title: opts.title,
      goal: opts.goal,
      dependsOn: opts.dependsOn,
      deliverables: opts.deliverable,
      criteria: opts.criterion,
      verify: opts.verify,
      sources: opts.source,
      effort: opts.effort,
      risk: opts.risk,
      needsDesign: opts.needsDesign,
      needsBreakdown: opts.needsBreakdown,
      future: opts.future,
    }),
  );
}

export function taskList(opts: { json: boolean; goal?: string; status?: string }): void {
  const filter: { goal?: string; status?: string } = {};
  if (opts.goal !== undefined) filter.goal = opts.goal;
  if (opts.status !== undefined) filter.status = opts.status;
  const tasks = listTasks(openStore(), filter);
  emitRead(tasks, opts.json, () =>
    tasks.length === 0
      ? "no tasks"
      : table(
          ["task", "status", "flags", "title"],
          tasks.map((t) => [t.id, t.status, flagMarks(t), t.title]),
        ),
  );
}

export function taskShow(id: string): void {
  // The detail view is the JSON either way — every field matters and a table hides some.
  emitJson(getTask(openStore(), id));
}

export function taskClaim(
  id: string,
  opts: { by?: string; force: boolean; ifRevision?: string },
): void {
  emitJson(
    claimTask(openStore(), id, {
      by: opts.by,
      force: opts.force,
      ifRevision: parseIfRevision(opts.ifRevision),
    }),
  );
}

export function taskBlock(
  id: string,
  opts: { reason?: string; until?: string; ifRevision?: string },
): void {
  emitJson(
    blockTask(openStore(), id, {
      reason: opts.reason,
      until: opts.until,
      ifRevision: parseIfRevision(opts.ifRevision),
    }),
  );
}

export function taskComplete(id: string, opts: { evidence?: string; ifRevision?: string }): void {
  emitJson(completeTask(openStore(), id, { evidence: opts.evidence, ifRevision: parseIfRevision(opts.ifRevision) }));
}

export function taskRelease(id: string, opts: { ifRevision?: string }): void {
  emitJson(releaseTask(openStore(), id, { ifRevision: parseIfRevision(opts.ifRevision) }));
}
